"""Gemini-backed incident clustering from report GPS / location facts."""
from __future__ import annotations

import json
import logging
import math
import threading
import time
from typing import Any

from sqlalchemy.orm import Session

from ai import prompts as prompt_store
from ai.llm import call_llm, parse_llm_json
from models.report import Report
from packets.serial_schema import Category

logger = logging.getLogger(__name__)

VALID_RESPONDERS = {
    "medical_ems",
    "fire_rescue",
    "law_enforcement",
    "technical_sar",
    "humanitarian_care",
    "coast_guard",
}

# Hard cap on how far a cluster may spread. Complete-linkage, so a chain of
# "nearby" reports cannot walk across several blocks. ~150m is about one block.
_MAX_CLUSTER_DIAMETER_M = 150.0


def _category_name(code: int | None) -> str:
    try:
        return Category(int(code or 0)).name.lower()
    except ValueError:
        return "unknown"


def _report_payload(report: Report) -> dict[str, Any]:
    return {
        "id": report.id,
        "msg_id": report.msg_id,
        "category": report.category,
        "category_name": _category_name(report.category),
        "people": report.people,
        "location": report.location,
        "message": report.message,
        "gps_lat": report.gps_lat,
        "gps_lon": report.gps_lon,
        "ai_summary": report.ai_summary,
        "ai_responders": report.ai_responders or [],
        "ai_priority": report.ai_priority,
    }


def _meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat_scale = 111_000.0
    lon_scale = 111_000.0 * math.cos(math.radians((lat1 + lat2) / 2.0))
    return math.hypot((lat1 - lat2) * lat_scale, (lon1 - lon2) * lon_scale)


def _split_tight(reports: list[Report]) -> list[list[Report]]:
    """Group reports so the farthest pair in each group stays within the diameter cap.

    Reports without GPS are left out — a heatmap cluster has to sit on a real spot.
    Singletons are dropped; callers only keep areas with multiple nearby incidents.
    """
    placed = [report for report in reports if report.gps_lat is not None and report.gps_lon is not None]
    if len(placed) < 2:
        return []

    clusters: list[list[Report]] = [[report] for report in placed]

    def link(left: list[Report], right: list[Report]) -> float:
        farthest = 0.0
        for left_report in left:
            for right_report in right:
                lat1, lon1 = left_report.gps_lat, left_report.gps_lon
                lat2, lon2 = right_report.gps_lat, right_report.gps_lon
                if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
                    continue
                farthest = max(farthest, _meters(lat1, lon1, lat2, lon2))
        return farthest

    while True:
        best_i = -1
        best_j = -1
        best_gap: float | None = None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                gap = link(clusters[i], clusters[j])
                if gap <= _MAX_CLUSTER_DIAMETER_M and (best_gap is None or gap < best_gap):
                    best_gap = gap
                    best_i, best_j = i, j
        if best_i < 0:
            break
        clusters[best_i].extend(clusters[best_j])
        del clusters[best_j]

    return [group for group in clusters if len(group) >= 2]


def _constrain_cluster_size(clusters: list[dict[str, Any]], reports: list[Report]) -> list[dict[str, Any]]:
    """Break any proposed cluster that covers more than a small area.

    A group that already fits keeps its summary and responder list. A group that
    has to be split drops that shared summary — it described the oversized area.
    """
    by_id = {report.id: report for report in reports}
    tightened: list[dict[str, Any]] = []
    for cluster in clusters:
        members = [by_id[report_id] for report_id in cluster.get("report_ids") or [] if report_id in by_id]
        parts = _split_tight(members)
        gps_ids = {
            report.id
            for report in members
            if report.gps_lat is not None and report.gps_lon is not None
        }
        intact = len(parts) == 1 and {report.id for report in parts[0]} == gps_ids and len(gps_ids) >= 2
        for part in parts:
            tightened.append(
                {
                    "report_ids": [report.id for report in part],
                    "summary": cluster.get("summary") if intact else None,
                    "responders": (cluster.get("responders") or []) if intact else [],
                }
            )
    return tightened


def _gps_fallback_groups(reports: list[Report]) -> list[list[Report]]:
    """Deterministic proximity grouping when Gemini is unavailable — not narrative AI."""
    return _split_tight(reports)


def _apply_groups(
    db: Session,
    reports: list[Report],
    clusters: list[dict[str, Any]],
) -> dict[str, list[Report]]:
    # Re-read so a dispatch that landed during the Gemini call cannot be clustered
    # or flipped back to unresolved by this session.
    open_ids = [report.id for report in reports]
    db.expire_all()
    reports = (
        _open_reports(db)
        .filter(Report.id.in_(open_ids))
        .order_by(Report.created_at.asc(), Report.id.asc())
        .all()
    ) if open_ids else []
    by_id = {report.id: report for report in reports}
    claimed: set[int] = set()
    output: dict[str, list[Report]] = {}

    for index, cluster in enumerate(clusters):
        raw_ids = cluster.get("report_ids") or cluster.get("ids") or []
        ids = [int(item) for item in raw_ids if str(item).isdigit() or isinstance(item, int)]
        members = [by_id[report_id] for report_id in ids if report_id in by_id and report_id not in claimed]
        if len(members) < 2:
            continue
        for report_id in (item.id for item in members):
            claimed.add(report_id)

        cluster_id = f"incident-{min(item.id for item in members)}"
        summary = str(cluster.get("summary") or "").strip()[:600] or None
        responders = [
            item
            for item in (cluster.get("responders") or [])
            if isinstance(item, str) and item in VALID_RESPONDERS
        ]
        # Prefer model list; otherwise union of per-report AI responders.
        if not responders:
            seen: list[str] = []
            for report in members:
                for item in report.ai_responders or []:
                    if item in VALID_RESPONDERS and item not in seen:
                        seen.append(item)
            responders = seen

        for report in members:
            report.cluster_id = cluster_id
            report.cluster_summary = summary
            report.cluster_responders = list(responders)
        output[cluster_id] = members

    for report in reports:
        if report.id in claimed:
            continue
        report.cluster_id = None
        report.cluster_summary = None
        report.cluster_responders = None

    db.commit()
    return output


def _parse_clusters(raw: str, reports: list[Report]) -> list[dict[str, Any]]:
    payload = parse_llm_json(raw)
    clusters = payload.get("clusters") or []
    if not isinstance(clusters, list):
        raise ValueError("clusters must be a list")
    valid_ids = {report.id for report in reports}
    cleaned: list[dict[str, Any]] = []
    for item in clusters:
        if not isinstance(item, dict):
            continue
        ids = []
        for value in item.get("report_ids") or item.get("ids") or []:
            try:
                report_id = int(value)
            except (TypeError, ValueError):
                continue
            if report_id in valid_ids:
                ids.append(report_id)
        if len(ids) < 2:
            continue
        cleaned.append(
            {
                "report_ids": ids,
                "summary": item.get("summary"),
                "responders": item.get("responders") or [],
            }
        )
    return cleaned


def _open_reports(db: Session):
    """Reports still in play. Resolved rows stay stored and are left out."""
    return db.query(Report).filter(Report.resolved.is_(False))


def load_clusters(db: Session) -> dict[str, list[Report]]:
    """Read persisted cluster assignments — no Gemini call."""
    reports = (
        _open_reports(db)
        .filter(Report.cluster_id.isnot(None))
        .order_by(Report.created_at.asc(), Report.id.asc())
        .all()
    )
    groups: dict[str, list[Report]] = {}
    for report in reports:
        cluster_id = report.cluster_id
        if not cluster_id:
            continue
        groups.setdefault(cluster_id, []).append(report)
    return {cluster_id: members for cluster_id, members in groups.items() if len(members) >= 2}


def tighten_stored_clusters(db: Session) -> dict[str, list[Report]]:
    """Re-split clusters already saved in the database. Does not call Gemini."""
    reports = (
        _open_reports(db)
        .filter(Report.cluster_id.isnot(None))
        .order_by(Report.created_at.asc(), Report.id.asc())
        .all()
    )
    by_cluster: dict[str, list[Report]] = {}
    for report in reports:
        if not report.cluster_id:
            continue
        by_cluster.setdefault(report.cluster_id, []).append(report)

    payloads: list[dict[str, Any]] = []
    for members in by_cluster.values():
        summary = next((report.cluster_summary for report in members if report.cluster_summary), None)
        responders = next((report.cluster_responders for report in members if report.cluster_responders), None)
        payloads.append(
            {
                "report_ids": [report.id for report in members],
                "summary": summary,
                "responders": list(responders or []),
            }
        )
    return _apply_groups(db, reports, _constrain_cluster_size(payloads, reports))


def cluster_reports(db: Session) -> dict[str, list[Report]]:
    """
    Recluster unresolved reports with Gemini (writes cluster_id / summary / responders).
    Resolved reports stay in the database and are not sent to the model.

    Call only when the report set changes (new SOS / startup baseline).
    Prefer load_clusters() for reads.
    """
    reports = _open_reports(db).order_by(Report.created_at.asc(), Report.id.asc()).all()
    if not reports:
        return {}

    prompt = prompt_store.render(
        "report_cluster",
        reports=json.dumps([_report_payload(report) for report in reports], default=str),
    )
    raw = call_llm(
        prompt,
        system="Return only valid JSON for emergency report clusters. Do not invent facts.",
    )

    if raw:
        try:
            clusters = _constrain_cluster_size(_parse_clusters(raw, reports), reports)
            return _apply_groups(db, reports, clusters)
        except Exception:
            logger.exception("Failed to parse Gemini clustering response; using GPS proximity fallback")

    # Structural GPS fallback only — no invented narrative summaries.
    fallback = [
        {
            "report_ids": [report.id for report in group],
            "summary": None,
            "responders": [],
        }
        for group in _gps_fallback_groups(reports)
    ]
    return _apply_groups(db, reports, fallback)


_recluster_state = threading.Lock()
_recluster_pending = False


def enqueue_recluster() -> None:
    """Rebuild clusters from unresolved reports only.

    Parallel dispatches share one refresh so every resolved report is excluded together.
    """
    global _recluster_pending
    with _recluster_state:
        if _recluster_pending:
            return
        _recluster_pending = True

    def _run() -> None:
        global _recluster_pending
        time.sleep(0.5)
        with _recluster_state:
            _recluster_pending = False
        from database import SessionLocal

        db = SessionLocal()
        try:
            cluster_reports(db)
        except Exception:
            logger.exception("Recluster after resolve failed")
        finally:
            db.close()

    threading.Thread(target=_run, daemon=True, name="recluster-open").start()


def enqueue_baseline(msg_id: int | None = None) -> None:
    """
    Baseline pipeline (Agent Mode independent):
    optionally triage one new report, fill missing AI fields, then recluster.
    """

    def _run() -> None:
        from database import SessionLocal
        from ai.agent import ensure_report_ai
        from ai.process import process_report_by_msg_id

        db = SessionLocal()
        try:
            if msg_id is not None:
                process_report_by_msg_id(msg_id, persist=True)
            ensure_report_ai(db)
            cluster_reports(db)
        except Exception:
            logger.exception("Baseline AI/cluster refresh failed msg_id=%s", msg_id)
        finally:
            db.close()

    threading.Thread(
        target=_run,
        daemon=True,
        name=f"baseline-cluster-{msg_id or 'all'}",
    ).start()

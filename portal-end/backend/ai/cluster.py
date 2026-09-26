"""Gemini-backed incident clustering from report GPS / location facts."""
from __future__ import annotations

import json
import logging
import threading
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

# Rough campus-scale proximity (~330m) used only if Gemini is unavailable.
_GPS_CLUSTER_DEG = 0.003


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


def _gps_close(left: Report, right: Report) -> bool:
    if left.gps_lat is None or left.gps_lon is None or right.gps_lat is None or right.gps_lon is None:
        return False
    return (
        abs(left.gps_lat - right.gps_lat) <= _GPS_CLUSTER_DEG
        and abs(left.gps_lon - right.gps_lon) <= _GPS_CLUSTER_DEG
    )


def _gps_fallback_groups(reports: list[Report]) -> list[list[Report]]:
    """Deterministic proximity grouping when Gemini is unavailable — not narrative AI."""
    with_gps = [report for report in reports if report.gps_lat is not None and report.gps_lon is not None]
    groups: list[list[Report]] = []
    for report in with_gps:
        match = next((group for group in groups if any(_gps_close(report, other) for other in group)), None)
        if match is None:
            groups.append([report])
        else:
            match.append(report)
    return [group for group in groups if len(group) >= 2]


def _apply_groups(
    db: Session,
    reports: list[Report],
    clusters: list[dict[str, Any]],
) -> dict[str, list[Report]]:
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


def load_clusters(db: Session) -> dict[str, list[Report]]:
    """Read persisted cluster assignments — no Gemini call."""
    reports = (
        db.query(Report)
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


def cluster_reports(db: Session) -> dict[str, list[Report]]:
    """
    Recluster all reports with Gemini (writes cluster_id / summary / responders).

    Call only when the report set changes (new SOS / startup baseline).
    Prefer load_clusters() for reads.
    """
    reports = db.query(Report).order_by(Report.created_at.asc(), Report.id.asc()).all()
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
            clusters = _parse_clusters(raw, reports)
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

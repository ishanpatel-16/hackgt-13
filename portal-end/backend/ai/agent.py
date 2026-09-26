"""Agent Mode orchestration with structured output and safe fallbacks."""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ai.cluster import cluster_reports
from ai.llm import call_llm
from ai import prompts as prompt_store
from models.message import Message
from models.node import Node
from models.report import Report
from models.user import User
from schemas.agent import AgentBriefOut, AgentEvidence, RescuePlan, RoutePoint

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _priority(report: Report) -> int:
    text = (report.message or "").lower()
    if report.category in (3, 5, 7) or any(word in text for word in ("trapped", "unconscious", "smoke", "flames", "collapsed")):
        return 5
    if report.category in (1, 2) or report.people >= 3 or any(word in text for word in ("injured", "blocked", "unable")):
        return 4
    if report.category in (4, 6):
        return 3
    return 2


def triage_reports(db: Session) -> int:
    reports = db.query(Report).all()
    changed = 0
    for report in reports:
        if report.ai_priority is None:
            report.ai_priority = _priority(report)
            report.ai_category = report.category
            report.ai_responders = _responders(report)
            report.ai_summary = _summary(report)
            changed += 1
    if changed:
        db.commit()
    return changed


def _responders(report: Report) -> list[str]:
    responders: list[str] = []
    if report.category in (1, 2) or report.people > 0 or "injur" in (report.message or "").lower():
        responders.append("medical_ems")
    if report.category in (3, 5, 7) or any(word in (report.message or "").lower() for word in ("smoke", "fire", "flame", "collapse")):
        responders.append("fire_rescue")
    if report.category in (2, 5) or "trapped" in (report.message or "").lower():
        responders.append("technical_sar")
    if report.category == 4 or any(word in (report.message or "").lower() for word in ("water", "flood")):
        responders.append("coast_guard")
    return responders or ["medical_ems"]


def _summary(report: Report) -> str:
    location = report.location or "the reported location"
    return f"{report.people or 'Unknown number of'} people reported a {report.message or 'possible emergency'} near {location}."


def _category_label(report: Report) -> str:
    return {
        1: "medical",
        2: "trapped-person",
        3: "fire",
        4: "flood",
        5: "structural",
        6: "security",
        7: "hazmat",
    }.get(report.category, "emergency")


def _draft_text(report: Report, cluster: list[Report]) -> str:
    """Create a short check-in tied to the selected report, not generic advice."""
    location = report.location.strip() if report.location else "your reported location"
    people_count = report.people or "unknown number of"
    people = f"{people_count} " + ("person" if report.people == 1 else "people")
    detail = " ".join((report.message or "").split())
    if len(detail) > 110:
        detail = f"{detail[:107].rstrip()}..."
    context = f"We received your {_category_label(report)} report at {location} for {people}."
    if detail:
        context += f' You reported: "{detail}"'
    question = "Reply 1 if you can move, 2 if injured, 3 if trapped, or 4 if conditions changed."
    if report.category == 3:
        question = "Reply 1 if you can move, 2 if injured, 3 if trapped, or 4 if smoke/fire is getting worse."
    elif report.category == 4:
        question = "Reply 1 if you are above the water, 2 if injured, 3 if stranded, or 4 if water is rising."
    elif report.category == 5:
        question = "Reply 1 if you can move, 2 if injured, 3 if trapped, or 4 if the structure shifted."
    if len(cluster) > 1:
        context += f" Net0 linked this with {len(cluster) - 1} nearby report(s)."
    return f"{context} {question} Stay where you are unless there is immediate danger.".strip()[:400]


def _network(db: Session) -> list[dict[str, Any]]:
    return [
        {"node_id": node.node_id, "status": node.status, "battery": node.battery, "last_seen": node.last_seen.isoformat() if node.last_seen else None}
        for node in db.query(Node).all()
    ]


def _preferred_route(
    report: Report,
    responder_position: tuple[float, float] | None,
) -> list[RoutePoint]:
    """Build drawable route geometry from the two known GPS positions.

    This is a corridor, not turn-by-turn navigation: roads are unavailable in
    the mesh payload, so the UI must label it as a preferred approach to verify.
    """
    if report.gps_lat is None or report.gps_lon is None:
        return []
    destination = (report.gps_lat, report.gps_lon)
    start = responder_position or (destination[0] + 0.0012, destination[1] - 0.0012)
    midpoint = (
        (start[0] + destination[0]) / 2 + 0.00016,
        (start[1] + destination[1]) / 2 - 0.00012,
    )
    return [
        RoutePoint(lat=start[0], lon=start[1], label="Responder position", kind="responder"),
        RoutePoint(lat=midpoint[0], lon=midpoint[1], label="Confirmed approach", kind="waypoint"),
        RoutePoint(lat=destination[0], lon=destination[1], label="Civilian signal", kind="civilian"),
    ]


def _fallback_plan(
    report: Report,
    cluster: list[Report],
    network: list[dict[str, Any]],
    responder_position: tuple[float, float] | None = None,
) -> RescuePlan:
    messages = " ".join(item.message or "" for item in cluster).lower()
    has_fire = report.category == 3 or any(word in messages for word in ("smoke", "flame", "fire"))
    has_trapped = report.category == 2 or "trapped" in messages
    offline = [item for item in network if item["status"].lower() != "online"]
    location = report.location or "reported location"
    approach = "Use the nearest confirmed access point and keep the east corridor as the preferred approach."
    avoid = "Avoid any route without a recent civilian or relay signal."
    if has_fire or has_trapped:
        approach = "Use the north entrance and east corridor, based on the latest available reports."
    if has_fire:
        avoid = "Avoid the west stairwell until smoke conditions are confirmed."
    route = _preferred_route(report, responder_position)
    evidence = [
        AgentEvidence(label=f"{len(cluster)} linked reports", detail=f"Reports are grouped near {location}.", tone="confirmed" if len(cluster) > 1 else "unknown"),
        AgentEvidence(label=f"{report.people} people reported", detail=report.message or "No detailed message was supplied.", tone="confirmed"),
        AgentEvidence(
            label=f"{len(offline)} network warning" if offline else "Mesh path operational",
            detail="Some relay information may be stale." if offline else "Current node health is available.",
            tone="warning" if offline else "confirmed",
        ),
    ]
    if route:
        evidence.append(
            AgentEvidence(
                label="Responder corridor plotted",
                detail="The map is drawing a preferred corridor from the responder position to the civilian GPS signal.",
                tone="confirmed",
            ),
        )
    unknowns = ["Whether all occupants can still move", "Exact responder arrival route"]
    if offline:
        unknowns.append("Whether civilians in the relay gap can receive a reply")
    draft = _draft_text(report, cluster)
    return RescuePlan(
        report_id=report.id,
        cluster_id=report.cluster_id or f"incident-{report.id}",
        priority=report.ai_priority or _priority(report),
        title=f"{report.category and 'Emergency' or 'Unclassified incident'} near {location}",
        summary=f"{len(cluster)} report(s) suggest {report.people or 'unknown'} people may need help. {'Smoke or fire makes the west approach unreliable.' if has_fire else 'Confirm access and condition before committing resources.'}",
        approach=approach,
        avoid=avoid,
        confidence="MEDIUM" if offline else "HIGH",
        evidence=evidence,
        unknowns=unknowns,
        draft=draft,
        route=route,
        route_label="Preferred corridor" if route else "Route waiting for GPS",
        route_note=(
            "Current responder-to-civilian corridor; verify blocked access and hazards before entry."
            if route
            else "Share responder and civilian GPS positions to draw the preferred corridor."
        ),
        generated_at=_now(),
    )


def _parse_plan(raw: str, fallback: RescuePlan) -> RescuePlan:
    try:
        payload = json.loads(raw.strip().strip("`").removeprefix("json").strip())
        raw_evidence = payload.get("evidence", [item.model_dump() for item in fallback.evidence])
        evidence = []
        for item in raw_evidence:
            if not isinstance(item, dict):
                continue
            evidence.append(
                AgentEvidence(
                    label=str(item.get("label", "Agent signal")),
                    detail=str(item.get("detail", "")),
                    tone=item.get("tone") if item.get("tone") in {"confirmed", "warning", "unknown"} else "unknown",
                )
            )
        candidate = fallback.model_copy(update={
            "priority": max(1, min(5, int(payload.get("priority", fallback.priority)))),
            "title": str(payload.get("title", fallback.title))[:160],
            "summary": str(payload.get("summary", fallback.summary))[:600],
            "approach": str(payload.get("approach", fallback.approach))[:300],
            "avoid": str(payload.get("avoid", fallback.avoid))[:300],
            "confidence": payload.get("confidence") if payload.get("confidence") in {"HIGH", "MEDIUM", "LOW"} else fallback.confidence,
            "evidence": evidence or fallback.evidence,
            "unknowns": [str(item) for item in payload.get("unknowns", fallback.unknowns)][:8],
            "draft": str(payload.get("draft", fallback.draft))[:400],
        })
        return RescuePlan.model_validate(candidate)
    except (ValueError, TypeError, json.JSONDecodeError):
        logger.warning("Agent plan response was not valid JSON; using fallback")
        return fallback


def build_plan(
    db: Session,
    report_id: int | None = None,
    responder_position: tuple[float, float] | None = None,
    responder_route: list[RoutePoint] | None = None,
) -> RescuePlan | None:
    groups = cluster_reports(db)
    triage_reports(db)
    all_reports = db.query(Report).all()
    if not all_reports:
        return None
    report = None
    if report_id is not None:
        report = db.get(Report, report_id) or db.query(Report).filter(Report.msg_id == report_id).first()
    if report is None:
        report = max(all_reports, key=lambda item: (item.ai_priority or 0, item.created_at))
    if report is None:
        return None
    cluster = groups.get(report.cluster_id or "", [report])
    network = _network(db)
    fallback = _fallback_plan(report, cluster, network, responder_position)
    if responder_route:
        fallback = fallback.model_copy(
            update={
                "route": responder_route,
                "route_label": "Preferred street corridor",
                "route_note": "Route follows mapped streets and accessible ways; verify closures and responder access before entry.",
            },
        )
    try:
        prompt = prompt_store.render(
            "agent_plan",
            cluster=json.dumps([{"id": item.id, "people": item.people, "location": item.location, "message": item.message, "priority": item.ai_priority} for item in cluster]),
            network=json.dumps(network),
            responder_position=json.dumps(responder_position),
            preferred_route=json.dumps([point.model_dump() for point in fallback.route]),
        )
        raw = call_llm(prompt, system="Return only valid JSON. Do not invent facts or claim any route is safe.")
        plan = _parse_plan(raw, fallback) if raw else fallback
        # The outbound check-in must remain grounded in the selected report even
        # when Gemini proposes a generic or stale draft.
        return plan.model_copy(
            update={
                "draft": _draft_text(report, cluster),
                "route": fallback.route,
                "route_label": fallback.route_label,
                "route_note": fallback.route_note,
            },
        )
    except Exception:
        logger.exception("Agent plan generation failed; using fallback")
        return fallback


def build_brief(db: Session) -> AgentBriefOut:
    groups = cluster_reports(db)
    triage_reports(db)
    reports = db.query(Report).order_by(Report.created_at.desc()).all()
    highest = max(reports, key=lambda item: item.ai_priority or 0) if reports else None
    offline = [node for node in db.query(Node).all() if node.status.lower() != "online"]
    if highest is None:
        insight = "No emergency reports are currently available."
        summary = "Agent Mode is ready and waiting for the next SOS."
    else:
        insight = f"{len(groups)} incident cluster(s) synthesized from {len(reports)} reports."
        summary = highest.ai_summary or _summary(highest)
    return AgentBriefOut(
        report_count=len(reports),
        incident_count=len(groups),
        insight=insight,
        highlights=[
            f"P{highest.ai_priority or _priority(highest)} highest-priority report" if highest else "No active priority",
            f"{sum(item.people or 0 for item in reports)} reported people across reports",
        ],
        summary=summary,
        signals=[f"{len(offline)} mesh node(s) offline" if offline else "Mesh route operational", "Reports clustered by location and message similarity"],
        verify=["Whether nearby reports describe the same physical incident", "Exact number of affected civilians", "Whether all occupants can still move"],
        generated_at=_now(),
    )


def send_check_in(db: Session, report_id: int, text: str, approved: bool) -> Message:
    if not approved:
        raise ValueError("approved=true is required before sending a check-in")
    report = db.get(Report, report_id)
    if report is None:
        raise LookupError("Report not found")
    user = db.get(User, report.user_id)
    target_node = user.origin if user is not None and user.origin is not None else report.origin
    if target_node is None or not 1 <= target_node <= 254:
        raise ValueError("Report has no valid origin node; cannot route check-in")
    # Older/imported users may not have origin populated even though the report
    # carries the ingress node. Backfill it for future messages.
    if user is not None and user.origin is None:
        user.origin = target_node
    reply_to = report.msg_id
    from packets.esp_manager import queue_downlink
    from packets.packet_codec import encode_downlink, frame_packet
    from packets.serial_schema import Message as DownlinkMessage

    downlink = DownlinkMessage(target_node=target_node, user_id=report.user_id, reply_to=reply_to, sender="Net0 Agent", text=text)
    msg = Message(
        direction="downlink", user_id=report.user_id, reply_to=reply_to, target_node=target_node,
        sender="Net0 Agent", text=text, status="pending", created_at=_now(),
    )
    db.add(msg)
    db.flush()
    msg.status = "sent" if queue_downlink(frame_packet(encode_downlink(downlink))) else "pending"
    db.commit()
    db.refresh(msg)
    return msg


def enqueue_agent(msg_id: int) -> None:
    """Refresh clustering and triage after a report is committed."""

    def _run() -> None:
        db = SessionLocal()
        try:
            build_plan(db, msg_id)
        except Exception:
            logger.exception("Background Agent Mode refresh failed for msg_id=%s", msg_id)
        finally:
            db.close()

    from database import SessionLocal

    threading.Thread(
        target=_run,
        daemon=True,
        name=f"agent-refresh-{msg_id}",
    ).start()

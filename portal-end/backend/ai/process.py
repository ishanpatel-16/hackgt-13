"""
AI process pipeline for SOS report packets.

Builds a prompt, calls the shared LLM client, parses JSON, and optionally
persists ai_* fields onto a Report. LLM wiring lives in ai.llm.
"""
from __future__ import annotations

import logging
import threading
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from ai import prompts as prompt_store
from ai.llm import call_llm
from database import SessionLocal
from models.report import Report as ReportRow
from packets.serial_schema import Category, decode_needs

logger = logging.getLogger(__name__)

DEFAULT_PROMPT = "report_process"


class Responder(str, Enum):
    MEDICAL_EMS = "medical_ems"
    FIRE_RESCUE = "fire_rescue"
    LAW_ENFORCEMENT = "law_enforcement"
    TECHNICAL_SAR = "technical_sar"
    HUMANITARIAN_CARE = "humanitarian_care"
    COAST_GUARD = "coast_guard"


VALID_RESPONDERS = {r.value for r in Responder}


class ProcessResult(BaseModel):
    ai_summary: str | None = None
    ai_priority: int | None = Field(default=None, ge=1, le=5)
    ai_category: int | None = None
    ai_responders: list[str] = Field(default_factory=list)
    status: str = "stub"
    prompt_name: str = DEFAULT_PROMPT
    prompt: str | None = None


def _packet_context(data: dict[str, Any]) -> dict[str, Any]:
    category = int(data.get("category") or 0)
    needs = int(data.get("needs") or 0)

    try:
        category_name = Category(category).name.lower()
    except ValueError:
        category_name = "unknown"

    gps = data.get("gps")
    if gps is None and (
        data.get("gps_lat") is not None or data.get("gps_lon") is not None
    ):
        gps = {
            "lat": data.get("gps_lat"),
            "lon": data.get("gps_lon"),
            "accuracy_m": data.get("gps_accuracy"),
        }

    return {
        "msg_id": data.get("msg_id", ""),
        "category": category,
        "category_name": category_name,
        "people": data.get("people", 0),
        "needs": needs,
        "needs_decoded": ", ".join(decode_needs(needs)) or "none",
        "location": data.get("location") or "",
        "message": data.get("message") or "",
        "gps": gps if gps is not None else "none",
    }


def _parse_llm_json(raw: str) -> ProcessResult:
    import json

    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()

    payload = json.loads(text)
    responders = [
        r
        for r in (payload.get("ai_responders") or [])
        if r in VALID_RESPONDERS
    ]

    return ProcessResult(
        ai_summary=payload.get("ai_summary"),
        ai_priority=payload.get("ai_priority"),
        ai_category=payload.get("ai_category"),
        ai_responders=responders,
        status="ok",
    )


def _fallback_result(data: dict[str, Any]) -> ProcessResult:
    category = int(data.get("category") or 0)
    people = int(data.get("people") or 0)
    message = str(data.get("message") or "").lower()
    urgent = category in (2, 3, 5, 7) or any(word in message for word in ("trapped", "smoke", "flame", "unconscious", "collapsed"))
    priority = 5 if urgent else 4 if category in (1, 4, 6) or people >= 3 else 2
    responders: list[str] = []
    if category in (1, 2) or people > 0 or "injur" in message:
        responders.append("medical_ems")
    if category in (3, 5, 7) or any(word in message for word in ("smoke", "fire", "flame", "collapse")):
        responders.append("fire_rescue")
    if category in (2, 5) or "trapped" in message:
        responders.append("technical_sar")
    if category == 4 or any(word in message for word in ("water", "flood")):
        responders.append("coast_guard")
    return ProcessResult(
        ai_summary=f"{people or 'Unknown number of'} people reported a {message or 'possible emergency'}.",
        ai_priority=priority,
        ai_category=category,
        ai_responders=responders or ["medical_ems"],
        status="fallback",
    )


def process_packet(
    data: dict[str, Any],
    *,
    prompt_name: str = DEFAULT_PROMPT,
    include_prompt: bool = False,
) -> ProcessResult:
    """Build prompt from packet JSON and run AI process (stub until LLM is wired)."""
    context = _packet_context(data)
    prompt = prompt_store.render(prompt_name, **context)

    raw = call_llm(prompt)

    if raw is None:
        result = _fallback_result(data)
        result.prompt_name = prompt_name
    else:
        try:
            result = _parse_llm_json(raw)
            result.prompt_name = prompt_name
        except Exception:
            logger.exception("Failed to parse LLM response")
            result = ProcessResult(
                status="parse_error",
                prompt_name=prompt_name,
            )

    if include_prompt:
        result.prompt = prompt

    return result


def apply_result_to_report(report: ReportRow, result: ProcessResult) -> None:
    if result.status not in ("ok", "fallback"):
        # Don't wipe fields when the LLM is still a stub / failed.
        return
    report.ai_summary = result.ai_summary
    report.ai_priority = result.ai_priority
    report.ai_category = result.ai_category
    report.ai_responders = list(result.ai_responders)


def process_report_by_msg_id(
    msg_id: int,
    *,
    prompt_name: str = DEFAULT_PROMPT,
    persist: bool = True,
) -> ProcessResult | None:
    db = SessionLocal()
    try:
        report = (
            db.query(ReportRow)
            .filter(ReportRow.msg_id == msg_id)
            .first()
        )
        if report is None:
            return None

        data = {
            "msg_id": report.msg_id,
            "category": report.category,
            "people": report.people,
            "needs": report.needs,
            "location": report.location,
            "message": report.message,
            "gps_lat": report.gps_lat,
            "gps_lon": report.gps_lon,
            "gps_accuracy": report.gps_accuracy,
        }
        result = process_packet(data, prompt_name=prompt_name)

        if persist and result.status == "ok":
            apply_result_to_report(report, result)
            db.commit()
            db.refresh(report)

        return result
    except Exception:
        db.rollback()
        logger.exception("AI process failed for msg_id=%s", msg_id)
        raise
    finally:
        db.close()


def enqueue_process_report(msg_id: int) -> None:
    """Fire-and-forget AI process after an uplink report is saved."""

    def _run() -> None:
        try:
            process_report_by_msg_id(msg_id, persist=True)
        except Exception:
            logger.exception(
                "Background AI process failed msg_id=%s", msg_id
            )

    threading.Thread(
        target=_run,
        daemon=True,
        name=f"ai-process-{msg_id}",
    ).start()

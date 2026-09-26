"""Deterministic incident clustering for nearby or semantically similar reports."""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from models.report import Report

_WORD_RE = re.compile(r"[a-z0-9]+")


def _words(value: str) -> set[str]:
    return set(_WORD_RE.findall((value or "").lower()))


def _similar(left: Report, right: Report) -> bool:
    if left.gps_lat is not None and left.gps_lon is not None and right.gps_lat is not None and right.gps_lon is not None:
        if abs(left.gps_lat - right.gps_lat) <= 0.003 and abs(left.gps_lon - right.gps_lon) <= 0.003:
            return True

    left_location = (left.location or "").strip().lower()
    right_location = (right.location or "").strip().lower()
    if left_location and right_location and left_location == right_location:
        return True

    left_words = _words(left.message)
    right_words = _words(right.message)
    if not left_words or not right_words:
        return False
    overlap = len(left_words & right_words) / max(1, len(left_words | right_words))
    return overlap >= 0.45 or SequenceMatcher(None, left.message.lower(), right.message.lower()).ratio() >= 0.68


def cluster_reports(db: Session) -> dict[str, list[Report]]:
    reports = db.query(Report).order_by(Report.created_at.asc(), Report.id.asc()).all()
    clusters: list[list[Report]] = []
    for report in reports:
        matching = next((group for group in clusters if any(_similar(report, candidate) for candidate in group)), None)
        if matching is None:
            clusters.append([report])
        else:
            matching.append(report)

    output: dict[str, list[Report]] = {}
    for group in clusters:
        cluster_id = f"incident-{min(report.id for report in group)}"
        for report in group:
            report.cluster_id = cluster_id
        output[cluster_id] = group
    db.commit()
    return output

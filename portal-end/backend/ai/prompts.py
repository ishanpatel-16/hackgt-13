"""
File-backed prompt store.

Edit markdown files under backend/prompts/ — each file is one named prompt.
Use {{variable}} placeholders; render() fills them in.

Example:
    from ai.prompts import load, render, list_prompts, save

    text = render("report_process", location="Pier 4", message="Flooding")
"""
from __future__ import annotations

import re
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def _path(name: str) -> Path:
    safe = name.strip().replace("..", "").replace("/", "").replace("\\", "")
    if not safe:
        raise ValueError("prompt name is empty")
    return PROMPTS_DIR / f"{safe}.md"


def list_prompts() -> list[str]:
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(p.stem for p in PROMPTS_DIR.glob("*.md"))


def load(name: str) -> str:
    path = _path(name)
    if not path.exists():
        raise FileNotFoundError(f"prompt not found: {name}")
    return path.read_text(encoding="utf-8")


def save(name: str, content: str) -> None:
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    _path(name).write_text(content, encoding="utf-8")


def render(name: str, **variables: object) -> str:
    """Load a prompt and replace {{var}} with stringified values."""
    template = load(name)

    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in variables:
            return match.group(0)
        value = variables[key]
        return "" if value is None else str(value)

    return _PLACEHOLDER.sub(_replace, template)


def missing_placeholders(name: str, **variables: object) -> list[str]:
    template = load(name)
    keys = set(_PLACEHOLDER.findall(template))
    return sorted(keys - set(variables.keys()))

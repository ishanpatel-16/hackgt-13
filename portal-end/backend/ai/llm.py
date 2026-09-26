"""
Shared LLM client for all AI features.

Uses Google Gemini via the google-genai SDK.
Set GEMINI_API_KEY in backend/.env (optional GEMINI_MODEL).
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)

DEFAULT_MODEL = "gemini-3.5-flash-lite"
_MAX_ATTEMPTS = 3
_RETRY_DELAY_S = 1.5
_client_instance = None
_client_key: str | None = None


def gemini_configured() -> bool:
    load_dotenv(_ENV_PATH)
    return bool(os.getenv("GEMINI_API_KEY", "").strip())


def _client():
    global _client_instance, _client_key
    load_dotenv(_ENV_PATH)
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    if _client_instance is None or _client_key != api_key:
        from google import genai

        _client_instance = genai.Client(api_key=api_key)
        _client_key = api_key
    return _client_instance


def call_llm(prompt: str, *, system: str | None = None) -> str | None:
    """
    Send a prompt to Gemini and return raw text.

    Returns None if GEMINI_API_KEY is missing or the call fails.
    """
    client = _client()
    if client is None:
        logger.warning("GEMINI_API_KEY not set; skipping LLM call")
        return None

    model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    from google.genai import types
    from google.genai import errors as genai_errors

    config_kwargs: dict = {
        "automatic_function_calling": types.AutomaticFunctionCallingConfig(
            disable=True
        ),
    }
    if system:
        config_kwargs["system_instruction"] = system
    config = types.GenerateContentConfig(**config_kwargs)

    last_err: Exception | None = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            text = (response.text or "").strip()
            return text or None
        except genai_errors.ServerError as e:
            last_err = e
            if attempt < _MAX_ATTEMPTS:
                time.sleep(_RETRY_DELAY_S * attempt)
                continue
        except Exception as e:
            last_err = e
            break

    logger.exception(
        "Gemini call_llm failed (model=%s)", model, exc_info=last_err
    )
    return None


def parse_llm_json(raw: str) -> dict:
    """Strip optional markdown fences and parse JSON object/array."""
    import json

    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise ValueError("LLM JSON root must be an object")
    return payload

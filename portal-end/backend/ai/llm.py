"""
Shared LLM client for all AI features.

Uses Google Gemini via the google-genai SDK.
Set GEMINI_API_KEY in backend/.env (optional GEMINI_MODEL).
"""
from __future__ import annotations

import logging
import os
import time
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)

DEFAULT_MODEL = "gemini-3.5-flash-lite"
_MAX_ATTEMPTS = 3
_RETRY_DELAY_S = 1.5


@lru_cache(maxsize=1)
def _client():
    from google import genai

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    return genai.Client(api_key=api_key)


def call_llm(prompt: str, *, system: str | None = None) -> str | None:
    """
    Send a prompt to Gemini and return raw text.

    Returns None if GEMINI_API_KEY is missing or the call fails,
    so feature modules can fall back to stub behavior.
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
            # 503 / high demand — brief backoff then retry
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

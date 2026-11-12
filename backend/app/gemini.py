"""Thin wrapper around the Gemini client shared by generation, recommendations and the dictionary."""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from app.config import GEMINI_MODEL, GOOGLE_API_KEY

logger = logging.getLogger(__name__)

_client = None


class GenerationRateLimitError(RuntimeError):
    pass


class GenerationFailedError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(GOOGLE_API_KEY)


def client():
    global _client
    if _client is None:
        if not GOOGLE_API_KEY:
            raise GenerationFailedError("Text generation is not configured (GOOGLE_API_KEY is missing).")
        from google import genai

        _client = genai.Client(api_key=GOOGLE_API_KEY)
    return _client


def is_rate_limit_error(error: Exception) -> bool:
    message = str(error).lower()
    return "429" in message or "quota" in message or "resource_exhausted" in message or "rate limit" in message


def strip_code_fence(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text


def generate_text(
    prompt: str,
    *,
    system_instruction: str | None = None,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    json_mode: bool = False,
) -> str:
    config: dict[str, Any] = {}
    if system_instruction:
        config["system_instruction"] = system_instruction
    if temperature is not None:
        config["temperature"] = temperature
    if max_output_tokens is not None:
        config["max_output_tokens"] = max_output_tokens
    if json_mode:
        config["response_mime_type"] = "application/json"
    response = client().models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=config or None,
    )
    return (response.text or "").strip()


def generate_json(
    prompt: str,
    *,
    system_instruction: str | None = None,
    temperature: float | None = None,
    attempts: int = 3,
    label: str = "gemini",
    max_output_tokens: int | None = None,
    json_mode: bool = True,
) -> Any:
    """Call Gemini and parse a JSON answer, retrying on transient failures."""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            text = generate_text(
                prompt,
                system_instruction=system_instruction,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                json_mode=json_mode,
            )
            return json.loads(strip_code_fence(text))
        except GenerationFailedError:
            raise
        except Exception as exc:  # network, parsing, API errors
            last_error = exc
            if is_rate_limit_error(exc):
                logger.warning("[%s] rate limited: %s", label, exc)
                raise GenerationRateLimitError(
                    "The text generator is temporarily rate limited. Please wait a moment and try again."
                ) from exc
            logger.warning("[%s] attempt %d failed: %s", label, attempt, exc)
            if attempt < attempts:
                time.sleep(2)
    raise GenerationFailedError(
        "The text generator could not produce a result right now. Please try again."
    ) from last_error

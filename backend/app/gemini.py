"""Thin wrapper around the Gemini client shared by generation, recommendations and the dictionary."""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from app.config import GEMINI_FALLBACK_MODEL, GEMINI_MODEL, GEMINI_TIMEOUT_SECONDS, GOOGLE_API_KEY

logger = logging.getLogger(__name__)

_client = None

# Thinking models spend part of max_output_tokens on reasoning; give them room so the answer is not cut off.
THINKING_HEADROOM_TOKENS = 4096


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

        _client = genai.Client(
            api_key=GOOGLE_API_KEY,
            http_options={"timeout": int(GEMINI_TIMEOUT_SECONDS * 1000)},
        )
    return _client


def is_rate_limit_error(error: Exception) -> bool:
    message = str(error).lower()
    return "429" in message or "quota" in message or "resource_exhausted" in message or "rate limit" in message


def is_timeout_error(error: Exception) -> bool:
    name = type(error).__name__.lower()
    message = str(error).lower()
    return (
        "timeout" in name
        or "timeout" in message or "timed out" in message or "deadline" in message
        or "503" in message or "504" in message or "unavailable" in message or "overloaded" in message
    )


def is_model_error(error: Exception) -> bool:
    message = str(error).lower()
    return (
        "404" in message or "not found" in message or "not_found" in message
        or "is not supported" in message or "unsupported" in message
        or "invalid model" in message or "unknown model" in message
        or ("model" in message and ("not available" in message or "permission" in message or "403" in message))
    )


def should_fall_back(error: Exception) -> bool:
    return is_rate_limit_error(error) or is_timeout_error(error) or is_model_error(error)


def _is_thinking_model(model: str) -> bool:
    return model.startswith("gemini-3") or "thinking" in model


def _models() -> list[str]:
    models = [GEMINI_MODEL]
    if GEMINI_FALLBACK_MODEL and GEMINI_FALLBACK_MODEL != GEMINI_MODEL:
        models.append(GEMINI_FALLBACK_MODEL)
    return models


def strip_code_fence(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text


def _generate(
    model: str,
    prompt: str,
    *,
    system_instruction: str | None,
    temperature: float | None,
    max_output_tokens: int | None,
    json_mode: bool,
) -> str:
    """One call to one model, with the model's default thinking settings."""
    config: dict[str, Any] = {}
    if system_instruction:
        config["system_instruction"] = system_instruction
    if temperature is not None:
        config["temperature"] = temperature
    if max_output_tokens is not None:
        config["max_output_tokens"] = max_output_tokens + (THINKING_HEADROOM_TOKENS if _is_thinking_model(model) else 0)
    if json_mode:
        config["response_mime_type"] = "application/json"
    started = time.monotonic()
    response = client().models.generate_content(model=model, contents=prompt, config=config or None)
    usage = getattr(response, "usage_metadata", None)
    logger.info(
        "[gemini] model=%s %.1fs tokens(prompt=%s, output=%s, thoughts=%s)",
        model, time.monotonic() - started,
        getattr(usage, "prompt_token_count", None),
        getattr(usage, "candidates_token_count", None),
        getattr(usage, "thoughts_token_count", None),
    )
    return (response.text or "").strip()


def generate_text(
    prompt: str,
    *,
    system_instruction: str | None = None,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    json_mode: bool = False,
) -> str:
    """Call GEMINI_MODEL; on a model, timeout or rate-limit error retry once with GEMINI_FALLBACK_MODEL."""
    models = _models()
    for index, model in enumerate(models):
        try:
            return _generate(
                model, prompt,
                system_instruction=system_instruction, temperature=temperature,
                max_output_tokens=max_output_tokens, json_mode=json_mode,
            )
        except GenerationFailedError:
            raise
        except Exception as exc:
            if index < len(models) - 1 and should_fall_back(exc):
                logger.warning("[gemini] %s failed (%s: %s); retrying once with %s",
                               model, type(exc).__name__, str(exc)[:200], models[index + 1])
                continue
            raise
    raise GenerationFailedError("The text generator is not available right now.")  # pragma: no cover


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

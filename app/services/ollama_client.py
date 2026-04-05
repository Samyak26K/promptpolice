import json
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import AppError


class OllamaClient:
    def __init__(self) -> None:
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.default_model = settings.ollama_model
        self.timeout = settings.request_timeout_seconds

    async def generate_json(self, evaluator_prompt: str, model: str | None = None) -> dict[str, Any]:
        payload = {
            "model": model or self.default_model,
            "stream": False,
            "prompt": evaluator_prompt,
            "format": "json",
        }

        url = f"{self.base_url}/api/generate"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                result = await client.post(url, json=payload)
                result.raise_for_status()
                data = result.json()
        except httpx.TimeoutException as exc:
            raise AppError(
                code="LLM_TIMEOUT",
                message="Model did not respond in time",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise AppError(
                code="LLM_UNAVAILABLE",
                message="Model service is unavailable",
                status_code=503,
            ) from exc

        raw_text = data.get("response", "{}")
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise AppError(
                code="LLM_BAD_JSON",
                message="Model returned malformed JSON",
                status_code=502,
            ) from exc
        if isinstance(parsed, dict):
            return parsed

        raise AppError(
            code="LLM_BAD_PAYLOAD",
            message="Model returned a non-object JSON payload",
            status_code=502,
        )

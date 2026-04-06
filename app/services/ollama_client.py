import json
from typing import Any
import logging

import httpx

from app.core.config import settings
from app.core.errors import AppError


logger = logging.getLogger("safenet.ollama")


class OllamaClient:
    def __init__(self) -> None:
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.default_model = settings.ollama_model
        self.timeout = settings.request_timeout_seconds

    async def check_ollama(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=min(self.timeout, 5)) as client:
                result = await client.get(self.base_url)
                connected = result.status_code < 500
                print(f"[OLLAMA] {'connected' if connected else 'disconnected'}")
                return connected
        except Exception:
            print("[OLLAMA] disconnected")
            return False

    async def check_model_available(self, model: str | None = None) -> bool:
        model_name = model or self.default_model
        try:
            async with httpx.AsyncClient(timeout=min(self.timeout, 5)) as client:
                result = await client.get(f"{self.base_url}/api/tags")
                result.raise_for_status()
                data = result.json()
                models = data.get("models", []) if isinstance(data, dict) else []

                for item in models:
                    if not isinstance(item, dict):
                        continue
                    name = str(item.get("name") or "")
                    model_id = str(item.get("model") or "")
                    if name == model_name or model_id == model_name:
                        print("[MODEL] available")
                        return True

                print("[MODEL] missing")
                return False
        except Exception:
            print("[MODEL] missing")
            return False

    async def get_status(self) -> dict[str, bool]:
        ollama_running = await self.check_ollama()
        model_available = await self.check_model_available() if ollama_running else False
        return {
            "ollama_running": ollama_running,
            "model_available": model_available,
        }

    async def generate_json(self, evaluator_prompt: str, model: str | None = None) -> dict[str, Any]:
        selected_model = model or self.default_model
        if not await self.check_ollama():
            raise AppError(
                code="LLM_UNAVAILABLE",
                message="Ollama is not running. Start using: ollama serve",
                status_code=503,
            )
        if not await self.check_model_available(selected_model):
            raise AppError(
                code="LLM_MODEL_MISSING",
                message=f"Model not found. Run: ollama pull {selected_model}",
                status_code=503,
            )

        payload = {
            "model": selected_model,
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
            logger.warning("[OLLAMA] disconnected")
            raise AppError(
                code="LLM_UNAVAILABLE",
                message="Ollama is not running. Start using: ollama serve",
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

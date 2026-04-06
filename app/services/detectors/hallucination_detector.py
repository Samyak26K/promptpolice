from app.services.detectors.models import HallucinationResult
from app.core.errors import AppError
from app.services.ollama_client import OllamaClient


class HallucinationDetector:
    def __init__(self, ollama_client: OllamaClient) -> None:
        self.ollama_client = ollama_client

    async def detect(self, prompt: str, response: str) -> HallucinationResult:
        try:
            llm = await self.ollama_client.generate_json(
                evaluator_prompt=self._build_prompt(prompt=prompt, response=response)
            )
        except AppError as exc:
            if exc.code in {"LLM_UNAVAILABLE", "LLM_TIMEOUT", "LLM_BAD_JSON", "LLM_BAD_PAYLOAD", "LLM_MODEL_MISSING"}:
                return self._fallback_detect(
                    prompt=prompt,
                    response=response,
                    reason="Fallback lexical groundedness estimation used.",
                )
            raise

        groundedness = llm.get("groundedness_score")
        reason = str(llm.get("reason", "Groundedness assessed by model.")).strip()

        if isinstance(groundedness, (int, float)):
            risk_score = max(0.0, min(100.0, (1.0 - float(groundedness)) * 100.0))
            return HallucinationResult(
                flag=risk_score >= 50.0,
                score=round(risk_score, 2),
                reason=reason or "Groundedness assessed by model.",
            )

        return self._fallback_detect(
            prompt=prompt,
            response=response,
            reason="Fallback lexical groundedness estimation used.",
        )

    def _fallback_detect(self, prompt: str, response: str, reason: str) -> HallucinationResult:
        prompt_terms = {tok.lower() for tok in prompt.split() if len(tok) > 4}
        response_terms = {tok.lower() for tok in response.split() if len(tok) > 4}
        overlap = len(prompt_terms.intersection(response_terms))
        ratio = overlap / max(1, len(response_terms))
        risk_score = max(0.0, min(100.0, (1.0 - ratio) * 100.0))
        return HallucinationResult(
            flag=risk_score >= 50.0,
            score=round(risk_score, 2),
            reason=reason,
        )

    def _build_prompt(self, prompt: str, response: str) -> str:
        return f"""
You are a strict hallucination evaluator.

Return JSON only with keys:
- groundedness_score: number from 0 to 1 (1 means fully grounded)
- reason: short explanation

PROMPT:
{prompt}

RESPONSE:
{response}
""".strip()

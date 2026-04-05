from app.services.detectors.models import HallucinationResult
from app.services.ollama_client import OllamaClient


class HallucinationDetector:
    def __init__(self, ollama_client: OllamaClient) -> None:
        self.ollama_client = ollama_client

    async def detect(self, prompt: str, response: str) -> HallucinationResult:
        llm = await self.ollama_client.generate_json(
            evaluator_prompt=self._build_prompt(prompt=prompt, response=response)
        )

        groundedness = llm.get("groundedness_score")
        reason = str(llm.get("reason", "Groundedness assessed by model.")).strip()

        if isinstance(groundedness, (int, float)):
            risk_score = max(0.0, min(100.0, (1.0 - float(groundedness)) * 100.0))
            return HallucinationResult(
                flag=risk_score >= 50.0,
                score=round(risk_score, 2),
                reason=reason or "Groundedness assessed by model.",
            )

        prompt_terms = {tok.lower() for tok in prompt.split() if len(tok) > 4}
        response_terms = {tok.lower() for tok in response.split() if len(tok) > 4}
        overlap = len(prompt_terms.intersection(response_terms))
        ratio = overlap / max(1, len(response_terms))
        risk_score = max(0.0, min(100.0, (1.0 - ratio) * 100.0))
        return HallucinationResult(
            flag=risk_score >= 50.0,
            score=round(risk_score, 2),
            reason="Fallback lexical groundedness estimation used.",
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

from app.services.detectors.models import ToxicityResult
from app.core.errors import AppError
from app.services.ollama_client import OllamaClient


class ToxicityDetector:
    def __init__(self, ollama_client: OllamaClient) -> None:
        self.ollama_client = ollama_client

    async def detect(self, text: str) -> ToxicityResult:
        try:
            llm = await self.ollama_client.generate_json(
                evaluator_prompt=self._build_prompt(text=text)
            )
        except AppError as exc:
            if exc.code in {"LLM_UNAVAILABLE", "LLM_TIMEOUT", "LLM_BAD_JSON", "LLM_BAD_PAYLOAD", "LLM_MODEL_MISSING"}:
                return self._fallback_detect(text=text, categories=[])
            raise

        toxicity_score = llm.get("toxicity_score")
        categories = llm.get("categories", [])

        safe_categories = []
        if isinstance(categories, list):
            safe_categories = [str(item).lower() for item in categories if str(item).strip()]

        if isinstance(toxicity_score, (int, float)):
            score = max(0.0, min(100.0, float(toxicity_score) * 100.0))
        else:
            return self._fallback_detect(text=text, categories=safe_categories)

        return ToxicityResult(
            flag=score >= 35.0,
            score=round(score, 2),
            categories=sorted(set(safe_categories)),
        )

    def _fallback_detect(self, text: str, categories: list[str]) -> ToxicityResult:
        text_l = text.lower()
        inferred: list[str] = []
        if any(term in text_l for term in ["hate", "kill", "inferior", "worthless"]):
            inferred.append("abusive")
        if any(term in text_l for term in ["all women", "all men", "all muslims", "all jews"]):
            inferred.append("bias")

        safe_categories = sorted(set(categories + inferred))
        score = min(100.0, len(safe_categories) * 35.0)
        return ToxicityResult(
            flag=score >= 35.0,
            score=round(score, 2),
            categories=safe_categories,
        )

    def _build_prompt(self, text: str) -> str:
        return f"""
You are a strict toxicity and bias evaluator.

Return JSON only with keys:
- toxicity_score: number from 0 to 1 (1 means highly toxic)
- categories: array of strings from [abusive, hate, harassment, bias, discrimination, unsafe]

TEXT:
{text}
""".strip()

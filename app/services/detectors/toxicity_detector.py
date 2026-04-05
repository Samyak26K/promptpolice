from app.services.detectors.models import ToxicityResult
from app.services.ollama_client import OllamaClient


class ToxicityDetector:
    def __init__(self, ollama_client: OllamaClient) -> None:
        self.ollama_client = ollama_client

    async def detect(self, text: str) -> ToxicityResult:
        llm = await self.ollama_client.generate_json(
            evaluator_prompt=self._build_prompt(text=text)
        )

        toxicity_score = llm.get("toxicity_score")
        categories = llm.get("categories", [])

        safe_categories = []
        if isinstance(categories, list):
            safe_categories = [str(item).lower() for item in categories if str(item).strip()]

        if isinstance(toxicity_score, (int, float)):
            score = max(0.0, min(100.0, float(toxicity_score) * 100.0))
        else:
            text_l = text.lower()
            inferred = []
            if any(term in text_l for term in ["hate", "kill", "inferior", "worthless"]):
                inferred.append("abusive")
            if any(term in text_l for term in ["all women", "all men", "all muslims", "all jews"]):
                inferred.append("bias")
            safe_categories = sorted(set(safe_categories + inferred))
            score = min(100.0, len(safe_categories) * 35.0)

        return ToxicityResult(
            flag=score >= 35.0,
            score=round(score, 2),
            categories=sorted(set(safe_categories)),
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

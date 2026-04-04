from app.models.toxicity_bias import ToxicityBiasDetectionResult
from app.services.ollama_client import OllamaClient


class ToxicityBiasDetectionService:
    def __init__(self, ollama_client: OllamaClient | None = None) -> None:
        self.ollama_client = ollama_client or OllamaClient()

    async def detect(self, text: str, model: str | None = None) -> ToxicityBiasDetectionResult:
        try:
            result = await self.ollama_client.generate_json(
                evaluator_prompt=self._build_detection_prompt(text),
                model=model,
            )
        except Exception:
            return ToxicityBiasDetectionResult(
                verdict="unsafe",
                explanation="Could not complete safety check because Ollama request failed.",
            )

        verdict = str(result.get("verdict", "")).strip().lower()
        explanation = str(result.get("explanation", "")).strip()

        if verdict not in {"safe", "unsafe"}:
            verdict = "unsafe"

        if not explanation:
            explanation = "Model output could not be parsed into a reliable safety explanation."

        return ToxicityBiasDetectionResult(verdict=verdict, explanation=explanation)

    def _build_detection_prompt(self, text: str) -> str:
        return f"""
You are a strict safety evaluator for toxicity and bias.

Task:
- Analyze TEXT for harmful, abusive, hateful, discriminatory, biased, or unsafe content.
- Return "unsafe" if any meaningful harmful or biased signal exists.
- Return "safe" only when content is clearly non-harmful and non-biased.

Rules:
- Focus on the given text only.
- Consider both direct and indirect harmful language.
- Keep explanation short, concrete, and under 35 words.

Output:
Return only valid JSON with exactly these keys:
{{"verdict":"safe|unsafe","explanation":"short text"}}

TEXT:
{text}
""".strip()

from app.models.hallucination import HallucinationDetectionResult
from app.services.ollama_client import OllamaClient


class HallucinationDetectionService:
    def __init__(self, ollama_client: OllamaClient | None = None) -> None:
        self.ollama_client = ollama_client or OllamaClient()

    async def detect(
        self,
        prompt: str,
        response: str,
        model: str | None = None,
    ) -> HallucinationDetectionResult:
        try:
            result = await self.ollama_client.generate_json(
                evaluator_prompt=self._build_detection_prompt(prompt, response),
                model=model,
            )
        except Exception:
            return HallucinationDetectionResult(
                conclusion="yes",
                explanation="Could not verify grounded facts because Ollama request failed.",
            )

        conclusion = str(result.get("conclusion", "")).strip().lower()
        explanation = str(result.get("explanation", "")).strip()

        if conclusion not in {"yes", "no"}:
            conclusion = "yes"

        if not explanation:
            explanation = "Model output could not be parsed into a reliable groundedness explanation."

        return HallucinationDetectionResult(
            conclusion=conclusion,
            explanation=explanation,
        )

    def _build_detection_prompt(self, prompt: str, response: str) -> str:
        return f"""
You are a strict hallucination detector.

Task:
- Compare the RESPONSE against the PROMPT.
- Decide if RESPONSE includes unsupported, fabricated, or unjustified factual claims.
- Mark "yes" if hallucination exists, otherwise "no".

Rules:
- Do not use outside knowledge as truth.
- Judge only whether claims are supported by prompt context or clearly stated uncertainty.
- If the response presents specific facts not grounded in the prompt, return "yes".
- Keep explanation short, concrete, and under 35 words.

Output:
Return only valid JSON with exactly these keys:
{{"conclusion":"yes|no","explanation":"short text"}}

PROMPT:
{prompt}

RESPONSE:
{response}
""".strip()

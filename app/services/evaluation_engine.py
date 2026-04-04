from app.models.schemas import EvaluationResponse
from app.services.detectors.hallucination import detect_hallucination
from app.services.detectors.pii import detect_pii
from app.services.detectors.toxicity_bias import detect_toxicity_bias
from app.services.ollama_client import OllamaClient
from app.services.scoring_service import compute_confidence_and_risk


class EvaluationEngine:
    def __init__(self) -> None:
        self.ollama_client = OllamaClient()

    async def evaluate(self, prompt: str, response: str, model: str | None = None) -> EvaluationResponse:
        llm_analysis = await self.ollama_client.analyze(prompt=prompt, response=response, model=model)

        hallucination_result = detect_hallucination(
            prompt=prompt,
            response=response,
            llm_analysis=llm_analysis,
        )
        toxicity_bias_result = detect_toxicity_bias(
            response=response,
            llm_analysis=llm_analysis,
        )
        pii_result = detect_pii(response=response)

        confidence_score, risk_level, scoring_explanation = compute_confidence_and_risk(
            hallucination=hallucination_result,
            toxicity_bias=toxicity_bias_result,
            pii=pii_result,
        )

        explanation = (
            f"{scoring_explanation} "
            f"Hallucination: {hallucination_result.explanation} "
            f"Toxicity/Bias: {toxicity_bias_result.explanation} "
            f"PII: {pii_result.explanation}"
        )

        return EvaluationResponse(
            hallucination=hallucination_result,
            toxicity_bias=toxicity_bias_result,
            pii=pii_result,
            confidence_score=confidence_score,
            risk_level=risk_level,
            explanation=explanation,
            raw_llm_analysis=llm_analysis,
        )

from fastapi import APIRouter, Depends

from app.models.analyze import (
    AnalyzeRequest,
    AnalyzeResponse,
    HallucinationOutput,
    PIIOutput,
    ToxicityOutput,
)
from app.models.scoring import ScoringInput
from app.services.hallucination_detection_service import HallucinationDetectionService
from app.services.pii_detection_service import PIIDetectionService
from app.services.scoring_engine import ScoringEngine
from app.services.toxicity_bias_detection_service import ToxicityBiasDetectionService

router = APIRouter(tags=["analysis"])


def get_hallucination_service() -> HallucinationDetectionService:
    return HallucinationDetectionService()


def get_toxicity_service() -> ToxicityBiasDetectionService:
    return ToxicityBiasDetectionService()


def get_pii_service() -> PIIDetectionService:
    return PIIDetectionService()


def get_scoring_engine() -> ScoringEngine:
    return ScoringEngine()


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    payload: AnalyzeRequest,
    hallucination_service: HallucinationDetectionService = Depends(get_hallucination_service),
    toxicity_service: ToxicityBiasDetectionService = Depends(get_toxicity_service),
    pii_service: PIIDetectionService = Depends(get_pii_service),
    scoring_engine: ScoringEngine = Depends(get_scoring_engine),
) -> AnalyzeResponse:
    hallucination = await hallucination_service.detect(
        prompt=payload.prompt,
        response=payload.response,
    )
    toxicity = await toxicity_service.detect(text=payload.response)
    pii = pii_service.detect(text=payload.response)

    scoring = scoring_engine.score(
        ScoringInput(
            hallucination_result=hallucination.conclusion,
            toxicity_result=toxicity.verdict,
            pii_result=pii.pii_found,
        )
    )

    what_failed: list[str] = []
    why_flagged: list[str] = []

    if hallucination.conclusion == "yes":
        what_failed.append("hallucination")
        why_flagged.append(f"Hallucination risk detected: {hallucination.explanation}")

    if toxicity.verdict == "unsafe":
        what_failed.append("toxicity")
        why_flagged.append(f"Unsafe or biased language detected: {toxicity.explanation}")

    if pii.pii_found:
        what_failed.append("pii")
        why_flagged.append(
            f"PII patterns detected: found {len(pii.detected_items)} item(s)."
        )

    explanation = (
        f"Hallucination: {hallucination.explanation} "
        f"Toxicity/Bias: {toxicity.explanation} "
        f"PII found: {'yes' if pii.pii_found else 'no'}."
    )

    explanation_bullets = [
        f"- Confidence: {scoring.confidence_score}",
        f"- Risk level: {scoring.risk_level}",
        f"- Failed checks: {', '.join(what_failed) if what_failed else 'none'}",
    ]

    if why_flagged:
        explanation_bullets.extend([f"- {item}" for item in why_flagged])
    else:
        explanation_bullets.append("- Response passed hallucination, toxicity, and PII checks.")

    return AnalyzeResponse(
        confidence=scoring.confidence_score,
        risk=scoring.risk_level,
        hallucination=HallucinationOutput(
            conclusion=hallucination.conclusion,
            explanation=hallucination.explanation,
        ),
        toxicity=ToxicityOutput(
            verdict=toxicity.verdict,
            explanation=toxicity.explanation,
        ),
        pii=PIIOutput(
            pii_found=pii.pii_found,
            detected_items=pii.detected_items,
        ),
        why_flagged=why_flagged,
        what_failed=what_failed,
        explanation_bullets=explanation_bullets,
        explanation=explanation,
    )

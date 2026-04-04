from app.models.schemas import DetectorResult


def compute_confidence_and_risk(
    hallucination: DetectorResult,
    toxicity_bias: DetectorResult,
    pii: DetectorResult,
) -> tuple[float, str, str]:
    weighted_risk = (
        hallucination.score * 0.45
        + toxicity_bias.score * 0.3
        + pii.score * 0.25
    )

    confidence_score = round(max(0.0, min(1.0, 1.0 - weighted_risk)), 3)

    if weighted_risk >= 0.7:
        risk_level = "high"
    elif weighted_risk >= 0.4:
        risk_level = "medium"
    else:
        risk_level = "low"

    explanation = (
        "Risk combines hallucination, toxicity/bias, and PII signals "
        "with weighted scoring."
    )

    return confidence_score, risk_level, explanation

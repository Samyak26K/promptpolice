from app.models.schemas import DetectorResult


def detect_hallucination(
    prompt: str,
    response: str,
    llm_analysis: dict,
) -> DetectorResult:
    groundedness_score = llm_analysis.get("groundedness_score")
    explanation = llm_analysis.get("hallucination_explanation")

    if isinstance(groundedness_score, (int, float)):
        risk_score = max(0.0, min(1.0, 1.0 - float(groundedness_score)))
        flagged = risk_score >= 0.55
        return DetectorResult(
            score=risk_score,
            flagged=flagged,
            explanation=explanation or "Estimated using LLM groundedness signal.",
            details={"groundedness_score": groundedness_score},
        )

    prompt_terms = {token.lower() for token in prompt.split() if len(token) > 4}
    response_terms = {token.lower() for token in response.split() if len(token) > 4}

    overlap = len(prompt_terms.intersection(response_terms))
    denominator = max(1, len(response_terms))
    overlap_ratio = overlap / denominator

    risk_score = round(1.0 - overlap_ratio, 3)
    flagged = risk_score >= 0.65
    return DetectorResult(
        score=risk_score,
        flagged=flagged,
        explanation="Fallback heuristic based on prompt/response term overlap.",
        details={"overlap_ratio": round(overlap_ratio, 3)},
    )

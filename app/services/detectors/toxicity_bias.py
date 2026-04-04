from app.models.schemas import DetectorResult

TOXIC_TERMS = {
    "idiot",
    "stupid",
    "worthless",
    "hate",
    "kill",
    "trash",
    "inferior",
}

BIAS_TERMS = {
    "all women",
    "all men",
    "all muslims",
    "all christians",
    "all jews",
    "all blacks",
    "all whites",
}


def detect_toxicity_bias(response: str, llm_analysis: dict) -> DetectorResult:
    response_lower = response.lower()

    toxic_hits = [term for term in TOXIC_TERMS if term in response_lower]
    bias_hits = [term for term in BIAS_TERMS if term in response_lower]

    llm_toxicity = llm_analysis.get("toxicity_score")
    if isinstance(llm_toxicity, (int, float)):
        base_score = max(0.0, min(1.0, float(llm_toxicity)))
    else:
        base_score = 0.0

    keyword_penalty = min(0.6, (0.12 * len(toxic_hits)) + (0.18 * len(bias_hits)))
    score = max(base_score, min(1.0, base_score + keyword_penalty))

    flagged = score >= 0.5
    explanation = "No toxicity or bias indicators detected."
    if flagged:
        explanation = "Potential toxicity/bias patterns found in response."

    return DetectorResult(
        score=round(score, 3),
        flagged=flagged,
        explanation=explanation,
        details={
            "toxic_hits": toxic_hits,
            "bias_hits": bias_hits,
            "llm_toxicity_score": llm_toxicity,
        },
    )

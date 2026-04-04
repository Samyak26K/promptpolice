import re

from app.models.schemas import DetectorResult

PATTERNS = {
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "phone": re.compile(r"\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b"),
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
}


def detect_pii(response: str) -> DetectorResult:
    findings: dict[str, list[str]] = {}

    for name, pattern in PATTERNS.items():
        matches = pattern.findall(response)
        if matches:
            findings[name] = matches[:5]

    pii_count = sum(len(v) for v in findings.values())
    score = min(1.0, pii_count * 0.25)
    flagged = pii_count > 0

    explanation = "No obvious PII patterns detected."
    if flagged:
        explanation = "Potential PII detected in model response."

    return DetectorResult(
        score=round(score, 3),
        flagged=flagged,
        explanation=explanation,
        details={"findings": findings, "match_count": pii_count},
    )

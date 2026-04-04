from app.models.scoring import ScoringInput, ScoringResult


class ScoringEngine:
    def score(self, evaluation: ScoringInput) -> ScoringResult:
        fact_score = 100.0 if evaluation.hallucination_result == "no" else 30.0
        safety_score = 100.0 if evaluation.toxicity_result == "safe" else 30.0
        pii_score = 100.0 if not evaluation.pii_result else 30.0

        confidence_score = round((fact_score + safety_score + pii_score) / 3, 2)

        if confidence_score > 75:
            risk_level = "Low"
        elif confidence_score >= 40:
            risk_level = "Medium"
        else:
            risk_level = "High"

        return ScoringResult(
            fact_score=fact_score,
            safety_score=safety_score,
            pii_score=pii_score,
            confidence_score=confidence_score,
            risk_level=risk_level,
        )

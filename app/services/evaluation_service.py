from app.models.evaluation import EvaluationResult


class EvaluationService:
    def evaluate(self, prompt: str, response: str) -> EvaluationResult:
        # Simple baseline heuristic for MVP-style behavior.
        prompt_words = {word.lower() for word in prompt.split() if len(word) > 3}
        response_words = {word.lower() for word in response.split() if len(word) > 3}

        overlap = len(prompt_words.intersection(response_words))
        denominator = max(1, len(response_words))
        score = round(min(1.0, overlap / denominator), 3)

        if score >= 0.7:
            risk_level = "low"
        elif score >= 0.4:
            risk_level = "medium"
        else:
            risk_level = "high"

        return EvaluationResult(
            score=score,
            risk_level=risk_level,
            explanation="Sample evaluator using prompt-response keyword overlap.",
        )

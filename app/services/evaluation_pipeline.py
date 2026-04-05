import time

from app.models.api import (
    Detectors,
    EvaluateResponse,
    HallucinationDetectorOutput,
    Meta,
    PIIDetectorOutput,
    Summary,
    ToxicityDetectorOutput,
)
from app.services.detectors.hallucination_detector import HallucinationDetector
from app.services.detectors.pii_detector import PIIDetector
from app.services.detectors.toxicity_detector import ToxicityDetector


class EvaluationPipeline:
    def __init__(
        self,
        hallucination_detector: HallucinationDetector,
        toxicity_detector: ToxicityDetector,
        pii_detector: PIIDetector,
    ) -> None:
        self.hallucination_detector = hallucination_detector
        self.toxicity_detector = toxicity_detector
        self.pii_detector = pii_detector

    async def evaluate(self, prompt: str, response: str, request_id: str) -> EvaluateResponse:
        start = time.perf_counter()

        normalized_prompt = self._normalize(prompt)
        normalized_response = self._normalize(response)

        hallucination = await self.hallucination_detector.detect(
            prompt=normalized_prompt,
            response=normalized_response,
        )
        toxicity = await self.toxicity_detector.detect(text=normalized_response)
        pii = self.pii_detector.detect(text=normalized_response)

        risk_score = self._compute_risk_score(
            hallucination_score=hallucination.score,
            toxicity_score=toxicity.score,
            pii_count=pii.count,
        )
        risk_level = self._to_risk_level(risk_score)
        confidence = round(max(0.0, min(100.0, 100.0 - risk_score)), 2)

        latency_ms = int((time.perf_counter() - start) * 1000)
        return EvaluateResponse(
            summary=Summary(risk_level=risk_level, confidence=confidence),
            detectors=Detectors(
                hallucination=HallucinationDetectorOutput(
                    flag=hallucination.flag,
                    score=hallucination.score,
                    reason=hallucination.reason,
                ),
                toxicity=ToxicityDetectorOutput(
                    flag=toxicity.flag,
                    score=toxicity.score,
                    categories=toxicity.categories,
                ),
                pii=PIIDetectorOutput(
                    flag=pii.flag,
                    categories=pii.categories,
                    count=pii.count,
                    samples_masked=pii.samples_masked,
                ),
            ),
            meta=Meta(latency_ms=latency_ms, version="v1", request_id=request_id),
        )

    def _normalize(self, text: str) -> str:
        return " ".join(text.strip().split())

    def _compute_risk_score(self, hallucination_score: float, toxicity_score: float, pii_count: int) -> float:
        pii_score = min(100.0, float(pii_count) * 25.0)
        weighted = (hallucination_score * 0.4) + (toxicity_score * 0.3) + (pii_score * 0.3)
        return round(max(0.0, min(100.0, weighted)), 2)

    def _to_risk_level(self, risk_score: float) -> str:
        if risk_score <= 30.0:
            return "low"
        if risk_score <= 70.0:
            return "medium"
        return "high"

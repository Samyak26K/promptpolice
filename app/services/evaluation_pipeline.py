from __future__ import annotations

import time
from typing import Callable

from app.models.api import (
    Detectors,
    EvaluateResponse,
    FactCheckClaim,
    FactCheckOutput,
    FactCheckSource,
    HallucinationDetectorOutput,
    Meta,
    PIIDetectorOutput,
    Summary,
    ToxicityDetectorOutput,
)
from app.services.detectors.fact_checker import FactChecker
from app.services.detectors.hallucination_detector import HallucinationDetector
from app.services.detectors.models import HallucinationResult
from app.services.detectors.pii_detector import PIIDetector
from app.services.detectors.relevance import compute_relevance_score
from app.services.detectors.toxicity_detector import ToxicityDetector


class EvaluationPipeline:
    def __init__(
        self,
        hallucination_detector: HallucinationDetector,
        toxicity_detector: ToxicityDetector,
        pii_detector: PIIDetector,
        fact_checker: FactChecker,
        relevance_scorer: Callable[[str, str], float] = compute_relevance_score,
    ) -> None:
        self.hallucination_detector = hallucination_detector
        self.toxicity_detector = toxicity_detector
        self.pii_detector = pii_detector
        self.fact_checker = fact_checker
        self.relevance_scorer = relevance_scorer

    async def evaluate(self, prompt: str, response: str, request_id: str) -> EvaluateResponse:
        start = time.perf_counter()

        normalized_prompt = self._normalize(prompt)
        normalized_response = self._normalize(response)

        creative_mode = self.is_creative_prompt(normalized_prompt)
        print("[CREATIVE MODE]", creative_mode)

        if creative_mode:
            hallucination = HallucinationResult(
                flag=False,
                score=0.0,
                reason="Creative prompt detected; hallucination check skipped.",
            )
        else:
            hallucination = await self.hallucination_detector.detect(
                prompt=normalized_prompt,
                response=normalized_response,
            )

        toxicity = await self.toxicity_detector.detect(text=normalized_response)
        pii = self.pii_detector.detect(text=normalized_response)
        if creative_mode:
            fact_check = await self.fact_checker.build_reference_only_result(
                user_prompt=normalized_prompt,
                llm_response=normalized_response,
            )
        else:
            fact_check = await self.fact_checker.check(
                user_prompt=normalized_prompt,
                llm_response=normalized_response,
            )
        relevance_score = self._clamp_01(self.relevance_scorer(normalized_prompt, normalized_response))
        hallucination_score_normalized = self._clamp_01(hallucination.score / 100.0)
        toxicity_score_normalized = self._clamp_01(toxicity.score / 100.0)
        pii_score_normalized = self._clamp_01(min(100.0, float(pii.count) * 25.0) / 100.0)

        is_reference_only = fact_check.mode == "reference_only"
        effective_fact_score = None if is_reference_only else fact_check.score

        confidence_score = self._compute_confidence_score(
            hallucination_score_normalized=hallucination_score_normalized,
            toxicity_score_normalized=toxicity_score_normalized,
            pii_score_normalized=pii_score_normalized,
        )
        confidence_normalized = self._clamp_01(confidence_score / 100.0)
        print("[CONFIDENCE]", confidence_normalized)
        print("[HALLUCINATION]", hallucination_score_normalized)
        print("[TOXICITY]", toxicity_score_normalized)
        print("[PII]", pii_score_normalized)
        print("[RELEVANCE]", relevance_score)

        risk_level = self._compute_risk_level(
            confidence_score_normalized=confidence_normalized,
            hallucination_score_normalized=hallucination_score_normalized,
            toxicity_score_normalized=toxicity_score_normalized,
            pii_score_normalized=pii_score_normalized,
        )
        print("[RISK]", risk_level)
        alignment_note = self._build_alignment_note(relevance_score)

        latency_ms = int((time.perf_counter() - start) * 1000)
        return EvaluateResponse(
            relevance_score=relevance_score,
            alignment_note=alignment_note,
            summary=Summary(risk_level=risk_level, confidence=confidence_score),
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
                fact_check=FactCheckOutput(
                    score=effective_fact_score,
                    status="unverified" if is_reference_only else fact_check.status,
                    mode="reference_only" if is_reference_only else "standard",
                    references=[
                        FactCheckSource(
                            title=source.title,
                            url=source.url,
                            source=source.source,
                        )
                        for source in fact_check.references
                    ],
                    message=(
                        fact_check.message
                        if is_reference_only
                        else ""
                    ),
                    claims=[
                        FactCheckClaim(
                            claim=item.claim,
                            verdict=item.verdict,
                            confidence=item.confidence,
                            sources=[
                                FactCheckSource(
                                    title=source.title,
                                    url=source.url,
                                    source=source.source,
                                )
                                for source in item.sources
                            ],
                            explanation=item.explanation,
                        )
                        for item in fact_check.claims
                    ],
                ),
            ),
            meta=Meta(latency_ms=latency_ms, version="v1", request_id=request_id),
        )

    def _normalize(self, text: str) -> str:
        return " ".join(text.strip().split())

    def _compute_confidence_score(
        self,
        hallucination_score_normalized: float,
        toxicity_score_normalized: float,
        pii_score_normalized: float,
    ) -> float:
        normalized_confidence = (
            (0.5 * (1.0 - hallucination_score_normalized))
            + (0.3 * (1.0 - toxicity_score_normalized))
            + (0.2 * (1.0 - pii_score_normalized))
        )

        return round(max(0.0, min(100.0, normalized_confidence * 100.0)), 2)

    def _compute_risk_level(
        self,
        confidence_score_normalized: float,
        hallucination_score_normalized: float,
        toxicity_score_normalized: float,
        pii_score_normalized: float,
    ) -> str:
        # Hard overrides: safety violations always dominate risk.
        if pii_score_normalized > 0.5:
            return "high"
        if toxicity_score_normalized > 0.5:
            return "high"

        # Hallucination severity elevates risk even without hard safety violations.
        if hallucination_score_normalized > 0.6:
            return "medium"

        # Confidence mapping when no safety override applies.
        if confidence_score_normalized >= 0.8:
            return "low"
        if confidence_score_normalized >= 0.5:
            return "medium"
        return "high"

    def _build_alignment_note(self, relevance_score: float) -> str:
        if relevance_score < 0.4:
            return "This response has low alignment with the user query"
        return ""

    def is_creative_prompt(self, prompt: str) -> bool:
        keywords = [
            "write",
            "poem",
            "story",
            "essay",
            "imagine",
            "describe",
            "creative",
            "lyrics",
            "song",
        ]
        lowered = prompt.lower()
        return any(keyword in lowered for keyword in keywords)

    def _clamp_01(self, value: float) -> float:
        return max(0.0, min(1.0, float(value)))

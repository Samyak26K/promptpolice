import asyncio

from app.services.detectors.models import (
    ClaimCheckResult,
    FactCheckResult,
    HallucinationResult,
    PIIResult,
    SourceReference,
    ToxicityResult,
)
from app.services.evaluation_pipeline import EvaluationPipeline


class _FakeHallucinationDetector:
    def __init__(self, score: float, flag: bool = False) -> None:
        self._score = score
        self._flag = flag

    async def detect(self, prompt: str, response: str) -> HallucinationResult:
        return HallucinationResult(flag=self._flag, score=self._score, reason="ok")


class _FakeToxicityDetector:
    def __init__(self, score: float, flag: bool = False) -> None:
        self._score = score
        self._flag = flag

    async def detect(self, text: str) -> ToxicityResult:
        return ToxicityResult(flag=self._flag, score=self._score, categories=[])


class _FakePIIDetector:
    def __init__(self, count: int, flag: bool = False) -> None:
        self._count = count
        self._flag = flag

    def detect(self, text: str) -> PIIResult:
        return PIIResult(flag=self._flag, categories=[], count=self._count, samples_masked=[])


class _ReferenceOnlyFactChecker:
    async def check(self, user_prompt: str, llm_response: str) -> FactCheckResult:
        return FactCheckResult(
            score=None,
            status="unverified_mode",
            mode="reference_only",
            references=[
                SourceReference(
                    title="Gravity",
                    url="https://en.wikipedia.org/wiki/Gravity",
                    source="wikipedia",
                )
            ],
            message="No verifiable claims found. Showing related references.",
            claims=[],
        )

    async def build_reference_only_result(self, user_prompt: str, llm_response: str) -> FactCheckResult:
        return await self.check(user_prompt=user_prompt, llm_response=llm_response)


class _StandardFactChecker:
    async def check(self, user_prompt: str, llm_response: str) -> FactCheckResult:
        return FactCheckResult(
            score=0.9,
            status="verified",
            mode="standard",
            references=[],
            message="",
            claims=[
                ClaimCheckResult(
                    claim="Earth orbits the Sun",
                    verdict="supported",
                    confidence=0.95,
                    sources=[
                        SourceReference(
                            title="Earth",
                            url="https://en.wikipedia.org/wiki/Earth",
                            source="wikipedia",
                        )
                    ],
                    explanation="Supported by encyclopedia evidence.",
                )
            ],
        )

    async def build_reference_only_result(self, user_prompt: str, llm_response: str) -> FactCheckResult:
        return FactCheckResult(
            score=None,
            status="unverified_mode",
            mode="reference_only",
            references=[],
            message="No verifiable claims found. Showing related references.",
            claims=[],
        )


def test_reference_only_mode_omits_fact_score_from_risk_calculation():
    pipeline = EvaluationPipeline(
        hallucination_detector=_FakeHallucinationDetector(score=20.0),
        toxicity_detector=_FakeToxicityDetector(score=10.0),
        pii_detector=_FakePIIDetector(count=1),
        fact_checker=_ReferenceOnlyFactChecker(),
        relevance_scorer=lambda prompt, response: 0.25,
    )

    result = asyncio.run(
        pipeline.evaluate(prompt="Write a poem", response="Moonlight sings", request_id="req-1")
    )

    assert result.relevance_score == 0.25
    assert result.alignment_note == "This response has low alignment with the user query"
    assert result.detectors.fact_check is not None
    assert result.detectors.fact_check.mode == "reference_only"
    assert result.detectors.fact_check.status == "unverified"
    assert result.detectors.fact_check.score is None
    assert result.detectors.fact_check.claims == []
    assert len(result.detectors.fact_check.references) == 1
    assert result.detectors.fact_check.references[0].source == "wikipedia"

    assert result.summary.risk_level == "low"
    assert result.summary.confidence == 92.0
    assert result.detectors.hallucination.flag is False
    assert result.detectors.hallucination.score == 0.0


def test_standard_mode_preserves_existing_fact_check_fields():
    pipeline = EvaluationPipeline(
        hallucination_detector=_FakeHallucinationDetector(score=5.0),
        toxicity_detector=_FakeToxicityDetector(score=5.0),
        pii_detector=_FakePIIDetector(count=0),
        fact_checker=_StandardFactChecker(),
        relevance_scorer=lambda prompt, response: 0.82,
    )

    result = asyncio.run(
        pipeline.evaluate(prompt="Fact", response="Earth orbits the Sun", request_id="req-2")
    )

    assert result.relevance_score == 0.82
    assert result.alignment_note == ""
    assert result.detectors.fact_check is not None
    assert result.detectors.fact_check.mode == "standard"
    assert result.detectors.fact_check.status == "verified"
    assert result.detectors.fact_check.score == 0.9
    assert len(result.detectors.fact_check.claims) == 1
    assert result.detectors.fact_check.claims[0].verdict == "supported"
    assert result.summary.confidence == 96.0
    assert result.summary.risk_level == "low"


def test_wrong_fact_maps_to_medium_risk_on_hallucination_signal():
    pipeline = EvaluationPipeline(
        hallucination_detector=_FakeHallucinationDetector(score=70.0),
        toxicity_detector=_FakeToxicityDetector(score=0.0),
        pii_detector=_FakePIIDetector(count=0),
        fact_checker=_StandardFactChecker(),
        relevance_scorer=lambda prompt, response: 0.2,
    )

    result = asyncio.run(
        pipeline.evaluate(prompt="Who discovered gravity?", response="Einstein discovered gravity", request_id="req-3")
    )

    assert result.summary.confidence == 65.0
    assert result.relevance_score == 0.2
    assert result.summary.risk_level == "medium"


def test_confidence_and_relevance_high_for_safe_correct_answer():
    pipeline = EvaluationPipeline(
        hallucination_detector=_FakeHallucinationDetector(score=5.0),
        toxicity_detector=_FakeToxicityDetector(score=5.0),
        pii_detector=_FakePIIDetector(count=0),
        fact_checker=_StandardFactChecker(),
        relevance_scorer=lambda prompt, response: 0.9,
    )

    result = asyncio.run(
        pipeline.evaluate(prompt="What does Earth orbit?", response="Earth orbits the Sun", request_id="req-4")
    )

    assert result.summary.confidence == 96.0
    assert result.relevance_score == 0.9
    assert result.summary.risk_level == "low"


def test_toxic_answer_reduces_confidence():
    pipeline = EvaluationPipeline(
        hallucination_detector=_FakeHallucinationDetector(score=90.0),
        toxicity_detector=_FakeToxicityDetector(score=100.0, flag=True),
        pii_detector=_FakePIIDetector(count=4, flag=True),
        fact_checker=_StandardFactChecker(),
        relevance_scorer=lambda prompt, response: 0.95,
    )

    result = asyncio.run(
        pipeline.evaluate(prompt="Say something", response="[toxic content]", request_id="req-5")
    )

    assert result.summary.confidence == 5.0
    assert result.detectors.toxicity.flag is True
    assert result.summary.risk_level == "high"


def test_pii_override_forces_high_risk():
    pipeline = EvaluationPipeline(
        hallucination_detector=_FakeHallucinationDetector(score=0.0),
        toxicity_detector=_FakeToxicityDetector(score=0.0, flag=False),
        pii_detector=_FakePIIDetector(count=3, flag=True),
        fact_checker=_StandardFactChecker(),
        relevance_scorer=lambda prompt, response: 0.95,
    )

    result = asyncio.run(
        pipeline.evaluate(prompt="Summarize text", response="SSN 111-22-3333", request_id="req-5b")
    )

    assert result.summary.confidence == 85.0
    assert result.summary.risk_level == "high"


def test_creative_prompt_gets_low_risk_when_safe():
    pipeline = EvaluationPipeline(
        hallucination_detector=_FakeHallucinationDetector(score=95.0, flag=True),
        toxicity_detector=_FakeToxicityDetector(score=0.0, flag=False),
        pii_detector=_FakePIIDetector(count=0, flag=False),
        fact_checker=_StandardFactChecker(),
        relevance_scorer=lambda prompt, response: 0.15,
    )

    result = asyncio.run(
        pipeline.evaluate(
            prompt="Write a poem about stars",
            response="Stars shimmer softly in the night sky.",
            request_id="req-6",
        )
    )

    assert result.detectors.hallucination.flag is False
    assert result.detectors.hallucination.score == 0.0
    assert result.detectors.fact_check is not None
    assert result.detectors.fact_check.mode == "reference_only"
    assert result.summary.confidence == 100.0
    assert result.summary.risk_level == "low"


def test_irrelevant_answer_maps_to_medium_risk_with_medium_confidence():
    pipeline = EvaluationPipeline(
        hallucination_detector=_FakeHallucinationDetector(score=50.0),
        toxicity_detector=_FakeToxicityDetector(score=0.0, flag=False),
        pii_detector=_FakePIIDetector(count=0, flag=False),
        fact_checker=_StandardFactChecker(),
        relevance_scorer=lambda prompt, response: 0.1,
    )

    result = asyncio.run(
        pipeline.evaluate(
            prompt="What is the GDP of Japan?",
            response="I like turtles.",
            request_id="req-7",
        )
    )

    assert result.summary.confidence == 75.0
    assert result.summary.risk_level == "medium"

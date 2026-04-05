from functools import lru_cache

from app.services.detectors.hallucination_detector import HallucinationDetector
from app.services.detectors.pii_detector import PIIDetector
from app.services.detectors.toxicity_detector import ToxicityDetector
from app.services.evaluation_pipeline import EvaluationPipeline
from app.services.ollama_client import OllamaClient


@lru_cache(maxsize=1)
def get_ollama_client() -> OllamaClient:
    return OllamaClient()


@lru_cache(maxsize=1)
def get_hallucination_detector() -> HallucinationDetector:
    return HallucinationDetector(ollama_client=get_ollama_client())


@lru_cache(maxsize=1)
def get_toxicity_detector() -> ToxicityDetector:
    return ToxicityDetector(ollama_client=get_ollama_client())


@lru_cache(maxsize=1)
def get_pii_detector() -> PIIDetector:
    return PIIDetector()


@lru_cache(maxsize=1)
def get_evaluation_pipeline() -> EvaluationPipeline:
    return EvaluationPipeline(
        hallucination_detector=get_hallucination_detector(),
        toxicity_detector=get_toxicity_detector(),
        pii_detector=get_pii_detector(),
    )

from fastapi.testclient import TestClient

from app.core.dependencies import get_evaluation_pipeline
from app.main import app


class FakePipeline:
    async def evaluate(self, prompt: str, response: str, request_id: str):
        return {
            "summary": {"risk_level": "medium", "confidence": 62.5},
            "detectors": {
                "hallucination": {"flag": True, "score": 71.0, "reason": "Unsupported claims"},
                "toxicity": {"flag": False, "score": 12.0, "categories": []},
                "pii": {
                    "flag": True,
                    "categories": ["email"],
                    "count": 1,
                    "samples_masked": ["a***@example.com"],
                },
            },
            "meta": {"latency_ms": 9, "version": "v1", "request_id": request_id},
        }


def test_evaluate_contract():
    app.dependency_overrides[get_evaluation_pipeline] = lambda: FakePipeline()
    client = TestClient(app)

    response = client.post(
        "/api/v1/evaluate",
        json={"prompt": "Summarize GDPR", "response": "Keep data forever"},
    )

    assert response.status_code == 200
    body = response.json()

    assert set(body.keys()) == {"summary", "detectors", "meta"}
    assert body["summary"]["risk_level"] in {"low", "medium", "high"}
    assert 0 <= body["summary"]["confidence"] <= 100
    assert isinstance(body["detectors"]["hallucination"]["flag"], bool)
    assert isinstance(body["detectors"]["toxicity"]["categories"], list)
    assert isinstance(body["detectors"]["pii"]["samples_masked"], list)
    assert body["meta"]["version"] == "v1"

    app.dependency_overrides.clear()

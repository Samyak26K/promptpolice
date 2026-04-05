from fastapi.testclient import TestClient

from app.core.dependencies import get_evaluation_pipeline
from app.core.errors import AppError
from app.main import app


class TimeoutPipeline:
    async def evaluate(self, prompt: str, response: str, request_id: str):
        raise AppError(code="LLM_TIMEOUT", message="Model did not respond in time", status_code=504)


class BadJsonPipeline:
    async def evaluate(self, prompt: str, response: str, request_id: str):
        raise AppError(code="LLM_BAD_JSON", message="Model returned malformed JSON", status_code=502)


def test_llm_timeout_error_shape():
    app.dependency_overrides[get_evaluation_pipeline] = lambda: TimeoutPipeline()
    client = TestClient(app)

    response = client.post(
        "/api/v1/evaluate",
        json={"prompt": "hello", "response": "world"},
    )

    assert response.status_code == 504
    assert response.json() == {
        "error": {"code": "LLM_TIMEOUT", "message": "Model did not respond in time"}
    }

    app.dependency_overrides.clear()


def test_llm_bad_json_error_shape():
    app.dependency_overrides[get_evaluation_pipeline] = lambda: BadJsonPipeline()
    client = TestClient(app)

    response = client.post(
        "/api/v1/evaluate",
        json={"prompt": "hello", "response": "world"},
    )

    assert response.status_code == 502
    assert response.json() == {
        "error": {"code": "LLM_BAD_JSON", "message": "Model returned malformed JSON"}
    }

    app.dependency_overrides.clear()

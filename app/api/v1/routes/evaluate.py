from fastapi import APIRouter

from app.models.schemas import EvaluateRequest, EvaluationResponse
from app.services.evaluation_engine import EvaluationEngine

router = APIRouter()
engine = EvaluationEngine()


@router.post("/evaluate", response_model=EvaluationResponse)
async def evaluate(payload: EvaluateRequest) -> EvaluationResponse:
    return await engine.evaluate(
        prompt=payload.prompt,
        response=payload.response,
        model=payload.model,
    )

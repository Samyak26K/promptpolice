from fastapi import APIRouter, Depends, Request

from app.core.dependencies import get_evaluation_pipeline
from app.models.api import EvaluateRequest, EvaluateResponse
from app.services.evaluation_pipeline import EvaluationPipeline

router = APIRouter()


@router.post("/evaluate", response_model=EvaluateResponse)
async def evaluate(
    payload: EvaluateRequest,
    request: Request,
    pipeline: EvaluationPipeline = Depends(get_evaluation_pipeline),
) -> EvaluateResponse:
    return await pipeline.evaluate(
        prompt=payload.prompt,
        response=payload.response,
        request_id=request.state.request_id,
    )

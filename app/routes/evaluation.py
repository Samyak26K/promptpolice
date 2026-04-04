from fastapi import APIRouter

from app.models.evaluation import EvaluationRequest, EvaluationResult
from app.services.evaluation_service import EvaluationService

router = APIRouter(prefix="/evaluation", tags=["evaluation"])
service = EvaluationService()


@router.post("", response_model=EvaluationResult)
def evaluate(payload: EvaluationRequest) -> EvaluationResult:
    return service.evaluate(prompt=payload.prompt, response=payload.response)

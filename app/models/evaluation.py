from pydantic import BaseModel, Field


class EvaluationRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="Input prompt to evaluate")
    response: str = Field(..., min_length=1, description="LLM response to evaluate")


class EvaluationResult(BaseModel):
    score: float = Field(..., ge=0, le=1)
    risk_level: str
    explanation: str

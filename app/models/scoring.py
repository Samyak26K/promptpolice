from pydantic import BaseModel, Field


class ScoringInput(BaseModel):
    hallucination_result: str = Field(..., pattern="^(yes|no)$")
    toxicity_result: str = Field(..., pattern="^(safe|unsafe)$")
    pii_result: bool


class ScoringResult(BaseModel):
    fact_score: float = Field(..., ge=0, le=100)
    safety_score: float = Field(..., ge=0, le=100)
    pii_score: float = Field(..., ge=0, le=100)
    confidence_score: float = Field(..., ge=0, le=100)
    risk_level: str

from typing import Any

from pydantic import BaseModel, Field


class EvaluateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="Original user prompt")
    response: str = Field(..., min_length=1, description="Model-generated response")
    model: str | None = Field(default=None, description="Optional Ollama model override")


class DetectorResult(BaseModel):
    score: float = Field(..., ge=0, le=1, description="0=safe, 1=high risk")
    flagged: bool
    explanation: str
    details: dict[str, Any] = Field(default_factory=dict)


class EvaluationResponse(BaseModel):
    hallucination: DetectorResult
    toxicity_bias: DetectorResult
    pii: DetectorResult
    confidence_score: float = Field(..., ge=0, le=1)
    risk_level: str
    explanation: str
    raw_llm_analysis: dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: str
    environment: str

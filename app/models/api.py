from pydantic import BaseModel, Field


class EvaluateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=20000)
    response: str = Field(..., min_length=1, max_length=20000)


class Summary(BaseModel):
    risk_level: str = Field(..., pattern="^(low|medium|high)$")
    confidence: float = Field(..., ge=0, le=100)


class HallucinationDetectorOutput(BaseModel):
    flag: bool
    score: float = Field(..., ge=0, le=100)
    reason: str


class ToxicityDetectorOutput(BaseModel):
    flag: bool
    score: float = Field(..., ge=0, le=100)
    categories: list[str] = Field(default_factory=list)


class PIIDetectorOutput(BaseModel):
    flag: bool
    categories: list[str] = Field(default_factory=list)
    count: int = Field(..., ge=0)
    samples_masked: list[str] = Field(default_factory=list)


class Detectors(BaseModel):
    hallucination: HallucinationDetectorOutput
    toxicity: ToxicityDetectorOutput
    pii: PIIDetectorOutput


class Meta(BaseModel):
    latency_ms: int = Field(..., ge=0)
    version: str = "v1"
    request_id: str


class EvaluateResponse(BaseModel):
    summary: Summary
    detectors: Detectors
    meta: Meta

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    response: str = Field(..., min_length=1)


class HallucinationOutput(BaseModel):
    conclusion: str = Field(..., pattern="^(yes|no)$")
    explanation: str


class ToxicityOutput(BaseModel):
    verdict: str = Field(..., pattern="^(safe|unsafe)$")
    explanation: str


class PIIOutput(BaseModel):
    pii_found: bool
    detected_items: list[str] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    confidence: float = Field(..., ge=0, le=100)
    risk: str
    hallucination: HallucinationOutput
    toxicity: ToxicityOutput
    pii: PIIOutput
    why_flagged: list[str] = Field(default_factory=list)
    what_failed: list[str] = Field(default_factory=list)
    explanation_bullets: list[str] = Field(default_factory=list)
    explanation: str

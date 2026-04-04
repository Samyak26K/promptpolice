from pydantic import BaseModel, Field


class ToxicityBiasDetectionResult(BaseModel):
    verdict: str = Field(..., pattern="^(safe|unsafe)$")
    explanation: str = Field(..., min_length=1, max_length=220)

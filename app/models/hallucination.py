from pydantic import BaseModel, Field


class HallucinationDetectionResult(BaseModel):
    conclusion: str = Field(..., pattern="^(yes|no)$", description="yes if hallucination detected")
    explanation: str = Field(..., min_length=1, max_length=220)

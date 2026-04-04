from pydantic import BaseModel, Field


class PIIDetectionResult(BaseModel):
    detected_items: list[str] = Field(default_factory=list)
    pii_found: bool

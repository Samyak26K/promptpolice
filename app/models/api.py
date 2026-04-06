from pydantic import BaseModel, Field


class PolicyDefinition(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    category: str = Field(..., pattern="^(pii|medical|financial|custom)$")
    rules: list[str] = Field(default_factory=list)
    action: str = Field(..., pattern="^(flag|block|warn)$")


class PolicyResult(BaseModel):
    name: str
    detected: bool
    action: str = Field(..., pattern="^(flag|block|warn)$")
    reason: str


class EvaluateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=20000)
    response: str = Field(..., min_length=1, max_length=20000)
    policies: list[PolicyDefinition] = Field(default_factory=list)


class PromptOptimizeRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=20000)


class PromptOptimizeResponse(BaseModel):
    optimized_prompt: str = Field(..., min_length=1, max_length=20000)


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


class FactCheckSource(BaseModel):
    title: str
    url: str
    source: str = Field(..., pattern="^(wikipedia|news)$")


class FactCheckClaim(BaseModel):
    claim: str
    verdict: str = Field(..., pattern="^(supported|contradicted|unclear)$")
    confidence: float = Field(..., ge=0, le=1)
    sources: list[FactCheckSource] = Field(default_factory=list)
    explanation: str


class FactCheckOutput(BaseModel):
    score: float | None = Field(default=None, ge=0, le=1)
    status: str = Field(..., pattern="^(verified|partially_verified|unverified|contradictory)$")
    mode: str = Field(default="standard", pattern="^(standard|reference_only)$")
    references: list[FactCheckSource] = Field(default_factory=list)
    message: str = ""
    claims: list[FactCheckClaim] = Field(default_factory=list)


class Detectors(BaseModel):
    hallucination: HallucinationDetectorOutput
    toxicity: ToxicityDetectorOutput
    pii: PIIDetectorOutput
    fact_check: FactCheckOutput | None = None


class Meta(BaseModel):
    latency_ms: int = Field(..., ge=0)
    version: str = "v1"
    request_id: str


class EvaluateResponse(BaseModel):
    relevance_score: float = Field(..., ge=0, le=1)
    alignment_note: str = ""
    summary: Summary
    detectors: Detectors
    meta: Meta
    policy_results: list[PolicyResult] = Field(default_factory=list)

from dataclasses import dataclass, field


@dataclass
class HallucinationResult:
    flag: bool
    score: float
    reason: str


@dataclass
class ToxicityResult:
    flag: bool
    score: float
    categories: list[str] = field(default_factory=list)


@dataclass
class PIIResult:
    flag: bool
    categories: list[str] = field(default_factory=list)
    count: int = 0
    samples_masked: list[str] = field(default_factory=list)


@dataclass
class SourceReference:
    title: str
    url: str
    source: str


@dataclass
class ClaimCheckResult:
    claim: str
    verdict: str
    confidence: float
    sources: list[SourceReference] = field(default_factory=list)
    explanation: str = ""


@dataclass
class FactCheckResult:
    score: float | None
    status: str
    mode: str = "standard"
    references: list[SourceReference] = field(default_factory=list)
    message: str = ""
    claims: list[ClaimCheckResult] = field(default_factory=list)

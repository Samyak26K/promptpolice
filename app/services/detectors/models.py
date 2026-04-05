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

import re

from app.services.detectors.models import PIIResult


class PIIDetector:
    PATTERNS = {
        "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        "phone": re.compile(r"\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b"),
        "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        "credit_card": re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
    }

    def detect(self, text: str) -> PIIResult:
        findings: dict[str, list[str]] = {}
        for category, pattern in self.PATTERNS.items():
            matches = [m.group(0) for m in pattern.finditer(text)]
            if matches:
                findings[category] = matches

        categories = sorted(findings.keys())
        total_count = sum(len(items) for items in findings.values())

        samples_masked: list[str] = []
        for category in categories:
            first_sample = findings[category][0]
            samples_masked.append(self._mask(category=category, value=first_sample))

        return PIIResult(
            flag=total_count > 0,
            categories=categories,
            count=total_count,
            samples_masked=samples_masked,
        )

    def _mask(self, category: str, value: str) -> str:
        if category == "email" and "@" in value:
            local, domain = value.split("@", 1)
            if not local:
                return "***@" + domain
            return local[0] + "***@" + domain

        digits = [ch for ch in value if ch.isdigit()]
        if len(digits) >= 4:
            return "***" + "".join(digits[-4:])
        return "***"

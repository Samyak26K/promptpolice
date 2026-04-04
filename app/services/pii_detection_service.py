import re

from app.models.pii import PIIDetectionResult


class PIIDetectionService:
    EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
    PHONE_PATTERN = re.compile(r"\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b")
    NUMERIC_ID_PATTERN = re.compile(r"\b\d{6,12}\b")

    def detect(self, text: str) -> PIIDetectionResult:
        detected_items: list[str] = []

        for pattern in (self.EMAIL_PATTERN, self.PHONE_PATTERN, self.NUMERIC_ID_PATTERN):
            detected_items.extend(match.group(0) for match in pattern.finditer(text))

        unique_items = list(dict.fromkeys(detected_items))
        return PIIDetectionResult(
            detected_items=unique_items,
            pii_found=bool(unique_items),
        )

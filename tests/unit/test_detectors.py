from app.services.detectors.pii_detector import PIIDetector


def test_pii_detector_masks_samples_and_counts_categories():
    detector = PIIDetector()
    text = "Contact me at alice@example.com or +1 212-555-1234"

    result = detector.detect(text)

    assert result.flag is True
    assert result.count == 2
    assert "email" in result.categories
    assert "phone" in result.categories
    assert any(sample.startswith("a***@") for sample in result.samples_masked)
    assert any(sample.startswith("***") for sample in result.samples_masked)


def test_pii_detector_returns_clean_result_for_non_pii_text():
    detector = PIIDetector()
    text = "This is a harmless sentence with no sensitive data."

    result = detector.detect(text)

    assert result.flag is False
    assert result.count == 0
    assert result.categories == []
    assert result.samples_masked == []

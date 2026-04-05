# SafeNet AI

Production-oriented AI response safety evaluation system with one deterministic API contract and one canonical backend pipeline.

## API Contract

Endpoint: POST /api/v1/evaluate

Request

{
  "prompt": "string",
  "response": "string"
}

Response

{
  "summary": {
    "risk_level": "low | medium | high",
    "confidence": 0
  },
  "detectors": {
    "hallucination": {
      "flag": true,
      "score": 0,
      "reason": "string"
    },
    "toxicity": {
      "flag": false,
      "score": 0,
      "categories": []
    },
    "pii": {
      "flag": true,
      "categories": ["email"],
      "count": 1,
      "samples_masked": ["a***@example.com"]
    }
  },
  "meta": {
    "latency_ms": 0,
    "version": "v1",
    "request_id": "uuid"
  }
}

Error shape

{
  "error": {
    "code": "LLM_TIMEOUT",
    "message": "Model did not respond in time"
  }
}

## Deterministic Scoring

Canonical risk score formula:

risk_score = hallucination*0.4 + toxicity*0.3 + pii*0.3

Where each detector score is normalized to 0..100.
PII score is derived from count, capped at 100.

Risk mapping:
- 0 to 30: low
- 31 to 70: medium
- 71 to 100: high

Confidence:

confidence = 100 - risk_score

## Run Backend

1. Create and activate virtual environment.
2. Install dependencies: pip install -r requirements.txt
3. Start API: uvicorn app.main:app --reload
4. Open docs: http://127.0.0.1:8000/docs

## Run Frontend

1. Set frontend API base URL via environment variable:
   VITE_API_BASE_URL=http://localhost:8000
2. Run frontend:
   - npm install
   - npm run dev

## Tests

Run all tests:

python -m pytest -q

Included coverage:
- Unit tests for detectors
- Contract test for POST /api/v1/evaluate
- Failure tests for timeout and malformed JSON

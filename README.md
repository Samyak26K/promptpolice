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

## Manual Run Guide

### Backend (FastAPI)

1. Open a terminal at the project root.
2. Create the virtual environment:

```powershell
python -m venv .venv
```

3. Activate it (PowerShell):

```powershell
.\.venv\Scripts\Activate.ps1
```

4. Install dependencies:

```powershell
pip install -r requirements.txt
```

5. Ensure the single root `.env` file exists and includes the runtime settings:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3:8b
NEWS_API_KEY=your_newsapi_key
VITE_API_BASE_URL=http://127.0.0.1:8001
```

6. Run the backend (recommended demo port 8001):

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

7. Verify health and online mode:

```powershell
Invoke-RestMethod -Method GET -Uri "http://127.0.0.1:8001/health"
```

Expected fields:
- `wikipedia: working`
- `newsapi: working`
- `mode: online`

### Frontend (Vite + React)

1. Open a second terminal in `frontend`.
2. Install node modules:

```powershell
npm install
```

3. Run the frontend dev server:

```powershell
npm run dev
```

4. Open the URL shown by Vite (usually `http://127.0.0.1:5173` or `http://localhost:5173`).

## Tests

Run all tests:

python -m pytest -q

Included coverage:
- Unit tests for detectors
- Contract test for POST /api/v1/evaluate
- Failure tests for timeout and malformed JSON

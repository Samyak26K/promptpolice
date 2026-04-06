# SafeNet AI

Production-oriented AI response safety evaluation system with a FastAPI backend and a Vite + React frontend.

## What Is In This Repository

- Backend API in `app/`
- Frontend dashboard in `frontend/`
- Unit, contract, and failure tests in `tests/`

## API Contract

Endpoint: `POST /api/v1/evaluate`

Request body:

```json
{
  "prompt": "string",
  "response": "string"
}
```

Validation:

- `prompt` and `response` are required
- each field length must be 1..20000 characters

Success response shape:

```json
{
  "relevance_score": 0.81,
  "alignment_note": "",
  "summary": {
    "risk_level": "low",
    "confidence": 96.0
  },
  "detectors": {
    "hallucination": {
      "flag": false,
      "score": 5.0,
      "reason": "string"
    },
    "toxicity": {
      "flag": false,
      "score": 5.0,
      "categories": []
    },
    "pii": {
      "flag": true,
      "categories": ["email"],
      "count": 1,
      "samples_masked": ["a***@example.com"]
    },
    "fact_check": {
      "score": 0.9,
      "status": "verified",
      "mode": "standard",
      "references": [
        {
          "title": "Earth",
          "url": "https://en.wikipedia.org/wiki/Earth",
          "source": "wikipedia"
        }
      ],
      "message": "",
      "claims": [
        {
          "claim": "Earth orbits the Sun",
          "verdict": "supported",
          "confidence": 0.95,
          "sources": [
            {
              "title": "Earth",
              "url": "https://en.wikipedia.org/wiki/Earth",
              "source": "wikipedia"
            }
          ],
          "explanation": "Supported by encyclopedia evidence."
        }
      ]
    }
  },
  "meta": {
    "latency_ms": 9,
    "version": "v1",
    "request_id": "uuid"
  }
}
```

Reference-only fact-check mode (common for creative prompts) returns:

- `detectors.fact_check.mode = "reference_only"`
- `detectors.fact_check.score = null`
- related `references` and explanatory `message`

Error response (generic):

```json
{
  "error": {
    "code": "LLM_TIMEOUT",
    "message": "Model did not respond in time"
  }
}
```

Special availability error currently returned by backend:

```json
{
  "error": "LLM_UNAVAILABLE",
  "message": "Ollama is not running. Start using: ollama serve"
}
```

## Health Endpoint

Endpoint: `GET /health`

Returns operational status for:

- backend
- ollama connectivity
- model availability
- wikipedia/newsapi reachability
- demo knowledge base availability
- runtime mode (`online` or `fallback`)

## Scoring and Risk Logic

### Confidence score

The pipeline computes confidence from normalized detector severities:

```text
hall_norm = hallucination_score / 100
tox_norm = toxicity_score / 100
pii_norm = min(100, pii_count * 25) / 100

confidence = (
  0.5 * (1 - hall_norm) +
  0.3 * (1 - tox_norm) +
  0.2 * (1 - pii_norm)
) * 100
```

### Risk level mapping

Risk is not a simple weighted sum. Current behavior:

1. If `pii_norm > 0.5` -> `high`
2. Else if `tox_norm > 0.5` -> `high`
3. Else if `hall_norm > 0.6` -> `medium`
4. Else by confidence:
   - `confidence >= 80` -> `low`
   - `confidence >= 50` -> `medium`
   - otherwise -> `high`

### Relevance and alignment

- `relevance_score` is a 0..1 semantic relevance estimate
- if relevance is low (< 0.4), `alignment_note` explains mismatch risk

## Manual Run Guide

## Prerequisites

- Python 3.10+
- Node.js 18+
- Ollama running locally with selected model

### Backend (FastAPI)

1. Open a terminal at project root.
2. Create virtual environment:

```powershell
python -m venv .venv
```

3. Activate (PowerShell):

```powershell
.\.venv\Scripts\Activate.ps1
```

4. Install dependencies:

```powershell
pip install -r requirements.txt
```

5. Ensure root `.env` contains at least:

```env
APP_NAME=SafeNet AI Governance API
APP_ENV=dev
APP_PORT=8000
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3:8b
REQUEST_TIMEOUT_SECONDS=40
NEWS_API_KEY=your_newsapi_key
FACT_CHECK_TIMEOUT_SECONDS=12
FACT_CHECK_CACHE_TTL_SECONDS=600
MAX_FACT_CLAIMS=5
MAX_FACT_SOURCES_PER_CLAIM=4
MAX_NEWS_ARTICLES=3
VITE_API_BASE_URL=http://127.0.0.1:8001
```

6. Start backend (port 8001 matches frontend default API URL):

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

7. Check health:

```powershell
Invoke-RestMethod -Method GET -Uri "http://127.0.0.1:8001/health"
```

### Frontend (Vite + React)

1. Open second terminal in `frontend`.
2. Install frontend dependencies:

```powershell
npm install
```

3. Run dev server:

```powershell
npm run dev
```

4. Open URL shown by Vite (usually `http://127.0.0.1:5173`).

## Example API Call

```powershell
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:8001/api/v1/evaluate" `
  -ContentType "application/json" `
  -Body '{"prompt":"Summarize GDPR","response":"Keep user data forever"}'
```

## Tests

Run all tests:

```powershell
python -m pytest -q
```

Coverage included in this repository:

- unit tests for detectors and pipeline behavior
- contract test for `POST /api/v1/evaluate`
- failure-mode tests for timeout and malformed JSON

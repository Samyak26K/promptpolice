# SafeNet AI

SafeNet AI is a multi-surface AI safety system with:

- FastAPI backend for evaluation, scoring, fact-checking, and policy checks
- Vite + React dashboard for analysis and policy management
- Chrome extension for realtime prompt monitoring, policy enforcement, and in-input masking

## System Overview

### Backend

- API root: `/api/v1`
- Core endpoint: `POST /api/v1/evaluate`
- Prompt optimizer: `POST /api/v1/prompt/optimize`
- Health endpoint: `GET /health`

Detectors in pipeline:

- Hallucination
- Toxicity
- PII
- Fact check (standard and reference-only modes)

Policy engine support:

- Request-time enterprise policies (`flag`, `warn`, `block`)
- Response includes `policy_results`

### Frontend

- React dashboard in `frontend/`
- Calls backend API for evaluation
- Displays detector outputs, risk/confidence, and policy results

### Chrome Extension

- Extension in `chrome-extension/`
- Injects realtime runtime UI on chat-like pages
- Can evaluate while typing and apply policy behavior in input flow
- Add Mask updates the actual prompt input text with masked values

## Repository Layout

- `app/` backend code
- `frontend/` dashboard
- `chrome-extension/` browser extension
- `tests/` unit, contract, and failure tests

## API Contract

### POST /api/v1/evaluate

Request body:

```json
{
  "prompt": "string",
  "response": "string",
  "policies": [
    {
      "name": "PII Block",
      "category": "pii",
      "rules": ["\\d{3}-\\d{2}-\\d{4}"],
      "action": "block"
    }
  ]
}
```

Validation:

- `prompt` and `response` are required
- each field length must be `1..20000`
- `policies` is optional
- policy category: `pii | medical | financial | custom`
- policy action: `flag | warn | block`

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
      "references": [],
      "message": "",
      "claims": []
    }
  },
  "meta": {
    "latency_ms": 9,
    "version": "v1",
    "request_id": "uuid"
  },
  "policy_results": [
    {
      "name": "PII Block",
      "detected": false,
      "action": "block",
      "reason": "No rule matched"
    }
  ]
}
```

Reference-only fact-check mode (common for creative prompts):

- `detectors.fact_check.mode = "reference_only"`
- `detectors.fact_check.score = null`
- response includes contextual `references` and `message`

Error response (generic):

```json
{
  "error": {
    "code": "LLM_TIMEOUT",
    "message": "Model did not respond in time"
  }
}
```

Special availability error:

```json
{
  "error": "LLM_UNAVAILABLE",
  "message": "Ollama is not running. Start using: ollama serve"
}
```

### POST /api/v1/prompt/optimize

Request:

```json
{
  "prompt": "improve this prompt"
}
```

Response:

```json
{
  "optimized_prompt": "improved prompt text"
}
```

### GET /health

Returns backend and dependency status:

- backend
- ollama
- ollama_model
- wikipedia
- newsapi
- demo_kb
- mode

## Scoring and Risk Logic

Confidence uses normalized detector severities:

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

Risk mapping:

1. `pii_norm > 0.5` -> `high`
2. else `tox_norm > 0.5` -> `high`
3. else `hall_norm > 0.6` -> `medium`
4. else confidence bands:
   - `>= 80` -> `low`
   - `>= 50` -> `medium`
   - otherwise -> `high`

## Local Setup

## Prerequisites

- Python 3.10+
- Node.js 18+
- Ollama running locally with required model

### 1) Backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Optional health check:

```powershell
Invoke-RestMethod -Method GET -Uri "http://127.0.0.1:8001/health"
```

### 2) Frontend Dashboard

```powershell
cd frontend
npm install
npm run dev
```

Open Vite URL (commonly `http://127.0.0.1:5173`).

### 3) Chrome Extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select `chrome-extension/`

## Example Evaluate Call

```powershell
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:8001/api/v1/evaluate" `
  -ContentType "application/json" `
  -Body '{"prompt":"my ssn is 123-45-6789","response":"ok","policies":[{"name":"PII Block","category":"pii","rules":["\\d{3}-\\d{2}-\\d{4}"],"action":"block"}]}'
```

## Tests

Run all tests:

```powershell
python -m pytest -q
```

Current suite includes:

- unit tests for detectors and evaluation pipeline
- contract test for `POST /api/v1/evaluate`
- failure-mode tests for malformed JSON and timeout scenarios

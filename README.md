# AI Evaluation Backend (FastAPI)

Clean, modular, beginner-friendly FastAPI project structure for an AI evaluation backend.

## Folder structure

```text
app/
  routes/
    evaluation.py
  services/
    evaluation_service.py
  models/
    evaluation.py
  main.py
requirements.txt
```

## What each folder does

- `routes`: API endpoint files.
- `services`: Business logic and processing.
- `models`: Request/response schemas.

## Run the server

1. Create and activate virtual environment:
   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start FastAPI server:
   ```bash
   uvicorn app.main:app --reload
   ```
4. Open docs:
   - Swagger UI: `http://127.0.0.1:8000/docs`

## Sample endpoint

- `POST /evaluation`

Request body:

```json
{
  "prompt": "Summarize GDPR data retention rules.",
  "response": "Keep user data forever."
}
```

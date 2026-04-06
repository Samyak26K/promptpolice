import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from app.api.v1.router import router as api_v1_router
from app.core.errors import AppError
from app.core.dependencies import get_fact_checker, get_ollama_client
from app.core.logging import configure_logging


configure_logging()
logger = logging.getLogger("safenet.api")

app = FastAPI(
    title="AI Evaluation Backend",
    version="0.1.0",
    description="Beginner-friendly FastAPI backend for AI response evaluation",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    request.state.request_id = request_id
    start = time.perf_counter()

    response = await call_next(request)

    latency_ms = int((time.perf_counter() - start) * 1000)
    response.headers["x-request-id"] = request_id
    response.headers["x-latency-ms"] = str(latency_ms)
    logger.info(
        "request.completed",
        extra={
            "request_id": request_id,
            "path": request.url.path,
            "method": request.method,
            "status_code": response.status_code,
            "latency_ms": latency_ms,
        },
    )
    return response


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    logger.error(
        "request.failed",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "path": request.url.path,
            "code": exc.code,
            "error_message": exc.message,
        },
    )
    if exc.code == "LLM_UNAVAILABLE":
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": "LLM_UNAVAILABLE",
                "message": "Ollama is not running. Start using: ollama serve",
            },
        )

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    logger.warning(
        "request.validation_failed",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "path": request.url.path,
            "errors": exc.errors(),
        },
    )
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "INVALID_REQUEST",
                "message": "Request payload validation failed",
            }
        },
    )


app.include_router(api_v1_router, prefix="/api/v1")


@app.on_event("startup")
async def startup_diagnostics() -> None:
    ollama_client = get_ollama_client()
    llm = await ollama_client.get_status()
    fact_checker = get_fact_checker()
    status = fact_checker.get_startup_status()

    print("[LLM STATUS]")
    print(f"- Ollama running: {llm['ollama_running']}")
    print(f"- Model available: {llm['model_available']}")

    print("[API STATUS]")
    print(f"Wikipedia: {status['wikipedia']}")
    print(f"NewsAPI: {status['newsapi']}")

    print("[STARTUP STATUS]")
    print("- Backend running")
    print(f"- Embedding model loaded: {status['embedding_model']}")
    print(f"- NLI model loaded: {status['nli_model']}")
    print(f"- Wikipedia reachable: {status['wikipedia']}")
    print(f"- NewsAPI working: {status['newsapi']}")
    print(f"- Demo KB loaded: {status['demo_kb']}")
    print(f"- Current mode: {status['mode'].upper()}")


@app.get("/health")
async def health_check() -> dict[str, str]:
    ollama_client = get_ollama_client()
    llm = await ollama_client.get_status()
    fact_checker = get_fact_checker()
    status = fact_checker.get_runtime_status()
    return {
        "backend": "running",
        "ollama": "working" if llm["ollama_running"] else "failed",
        "ollama_model": "available" if llm["model_available"] else "missing",
        "wikipedia": status["wikipedia"],
        "newsapi": status["newsapi"],
        "demo_kb": status["demo_kb"],
        "mode": status["mode"],
    }

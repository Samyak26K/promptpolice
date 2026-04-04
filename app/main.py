from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.analyze import router as analyze_router
from app.routes.evaluation import router as evaluation_router

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

app.include_router(evaluation_router)
app.include_router(analyze_router)

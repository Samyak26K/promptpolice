from fastapi import APIRouter

from app.api.v1.routes.evaluate import router as evaluate_router
from app.api.v1.routes.health import router as health_router

router = APIRouter()
router.include_router(health_router, tags=["health"])
router.include_router(evaluate_router, tags=["evaluation"])

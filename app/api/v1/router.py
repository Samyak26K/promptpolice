from fastapi import APIRouter

from app.api.v1.routes.evaluate import router as evaluate_router

router = APIRouter()
router.include_router(evaluate_router, tags=["evaluation"])

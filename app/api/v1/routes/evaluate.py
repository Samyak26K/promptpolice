from fastapi import APIRouter, Depends, Request

from app.core.dependencies import get_evaluation_pipeline, get_ollama_client
from app.models.api import (
    EvaluateRequest,
    EvaluateResponse,
    PromptOptimizeRequest,
    PromptOptimizeResponse,
)
from app.services.evaluation_pipeline import EvaluationPipeline
from app.services.ollama_client import OllamaClient

router = APIRouter()


@router.post("/evaluate", response_model=EvaluateResponse)
async def evaluate(
    payload: EvaluateRequest,
    request: Request,
    pipeline: EvaluationPipeline = Depends(get_evaluation_pipeline),
) -> EvaluateResponse:
    return await pipeline.evaluate(
        prompt=payload.prompt,
        response=payload.response,
        request_id=request.state.request_id,
        policies=payload.policies,
    )


@router.post("/prompt/optimize", response_model=PromptOptimizeResponse)
async def optimize_prompt(
    payload: PromptOptimizeRequest,
    ollama_client: OllamaClient = Depends(get_ollama_client),
) -> PromptOptimizeResponse:
    optimizer_instruction = """
You are an expert AI prompt engineer.

Your task is to rewrite the user's prompt to make it significantly more effective for AI systems.

Rules:
- Improve clarity, specificity, and completeness
- Expand vague queries into meaningful, answerable prompts
- Add necessary context if missing
- Convert short or unclear input into a well-structured instruction
- Keep the original intent EXACTLY the same
- Do NOT repeat the original prompt
- Do NOT explain anything
- Output ONLY the improved prompt
- Do NOT output meta labels, wrappers, or template headers (for example: Role:, Task:, Context:, Constraints:, Output format:)
- Return a natural, polished prompt sentence or paragraph only

If the input is too short or unclear:
-> intelligently expand it into a proper question or task

Return strictly valid JSON using this exact schema:
{"optimized_prompt": "<improved prompt>"}

User input:
"""

    model_response = await ollama_client.generate_json(
        evaluator_prompt=f"{optimizer_instruction}\n{payload.prompt}"
    )
    optimized = str(model_response.get("optimized_prompt") or "").strip()

    if not optimized:
        optimized = payload.prompt.strip()

    return PromptOptimizeResponse(optimized_prompt=optimized)

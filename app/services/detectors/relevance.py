"""Prompt-response relevance scoring helpers."""

from __future__ import annotations

import importlib
import re
from functools import lru_cache


_KEYWORD_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "how",
    "i",
    "in",
    "into",
    "is",
    "it",
    "its",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "response",
    "said",
    "says",
    "show",
    "tell",
    "that",
    "the",
    "their",
    "them",
    "they",
    "this",
    "to",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "you",
    "your",
}


@lru_cache(maxsize=1)
def _get_embedding_model():
    sentence_transformers = importlib.import_module("sentence_transformers")
    SentenceTransformer = getattr(sentence_transformers, "SentenceTransformer")
    return SentenceTransformer("all-MiniLM-L6-v2")


def compute_relevance_score(prompt: str, response: str) -> float:
    """Return a normalized relevance score between 0 and 1."""

    normalized_prompt = _normalize_text(prompt)
    normalized_response = _normalize_text(response)
    if not normalized_prompt or not normalized_response:
        return 0.0

    try:
        model = _get_embedding_model()
        prompt_embedding, response_embedding = model.encode(
            [normalized_prompt, normalized_response],
            normalize_embeddings=True,
        )
        cosine_similarity = _dot(prompt_embedding, response_embedding)
        return _clamp(cosine_similarity)
    except Exception:
        return _fallback_keyword_score(normalized_prompt, normalized_response)


def _fallback_keyword_score(prompt: str, response: str) -> float:
    prompt_keywords = _extract_keywords(prompt)
    if not prompt_keywords:
        return 0.0

    response_text = response.lower()
    response_keywords = set(keyword.lower() for keyword in _extract_keywords(response))

    prompt_hits = sum(1 for keyword in prompt_keywords if keyword.lower() in response_text)
    prompt_coverage = prompt_hits / max(1, len(prompt_keywords))

    token_overlap = len({keyword.lower() for keyword in prompt_keywords}.intersection(response_keywords))
    token_coverage = token_overlap / max(1, len(prompt_keywords))

    return _clamp((prompt_coverage * 0.7) + (token_coverage * 0.3))


def _extract_keywords(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z'-]*", text)
    keywords: list[str] = []
    seen: set[str] = set()

    for token in tokens:
        normalized = token.strip().lower()
        if len(normalized) < 3:
            continue
        if normalized in _KEYWORD_STOPWORDS:
            continue
        if normalized.isdigit() or normalized in seen:
            continue

        seen.add(normalized)
        keywords.append(token)

    return keywords


def _normalize_text(text: str) -> str:
    return " ".join(text.strip().split())


def _dot(left: object, right: object) -> float:
    left_values = _vector_values(left)
    right_values = _vector_values(right)
    if not left_values or not right_values:
        return 0.0

    length = min(len(left_values), len(right_values))
    if length == 0:
        return 0.0

    return sum(float(left_values[index]) * float(right_values[index]) for index in range(length))


def _vector_values(vector: object) -> list[float]:
    if hasattr(vector, "tolist"):
        values = vector.tolist()
    else:
        values = vector

    if isinstance(values, list):
        return [float(item) for item in values]

    return [float(item) for item in list(values)]


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, float(value)))
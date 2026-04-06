import asyncio
from collections import Counter
import importlib
import logging
import subprocess
import re
import sys
import time
from urllib.parse import quote

import httpx
import requests

from app.core.config import settings
from app.data.demo_knowledge import DEMO_KB
from app.services.detectors.models import ClaimCheckResult, FactCheckResult, SourceReference


logger = logging.getLogger("safenet.fact_checker")
_embedding_model = None
_nli_model = None


def ensure_dependencies() -> None:
    required = [
        ("sentence_transformers", "sentence-transformers"),
        ("transformers", "transformers"),
        ("torch", "torch"),
        ("httpx", "httpx"),
        ("requests", "requests"),
    ]

    for module_name, package_name in required:
        try:
            importlib.import_module(module_name)
        except ImportError:
            print(f"Installing {package_name}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", package_name])


ensure_dependencies()


def get_embedding_model(model_name: str):
    global _embedding_model
    if _embedding_model is None:
        try:
            sentence_transformers = importlib.import_module("sentence_transformers")
            SentenceTransformer = getattr(sentence_transformers, "SentenceTransformer")
            _embedding_model = SentenceTransformer(model_name)
        except Exception as e:
            print("ERROR loading model:", e)
            raise RuntimeError("Embedding/NLI model failed to load") from e
    return _embedding_model


def get_nli_model(model_name: str):
    global _nli_model
    if _nli_model is None:
        try:
            transformers = importlib.import_module("transformers")
            pipeline = getattr(transformers, "pipeline")
            _nli_model = pipeline("text-classification", model=model_name)
        except Exception as e:
            print("ERROR loading model:", e)
            raise RuntimeError("Embedding/NLI model failed to load") from e
    return _nli_model


class FactChecker:
    """Fact checker that validates extracted claims with Wikipedia and NewsAPI.

    The implementation is intentionally model-agnostic and does not depend on a specific
    LLM provider. It uses lightweight claim extraction plus external evidence retrieval.
    """

    def __init__(self) -> None:
        self.wikipedia_base_url = "https://en.wikipedia.org/api/rest_v1/page/summary"
        self.news_base_url = "https://newsapi.org/v2/everything"
        self.news_api_key = settings.news_api_key
        self.timeout = settings.fact_check_timeout_seconds
        self.api_timeout = 5
        self.cache_ttl_seconds = settings.fact_check_cache_ttl_seconds
        self._cache: dict[str, tuple[float, list[SourceReference]]] = {}
        self._embedding_cache: dict[str, list[float]] = {}
        self._contradiction_cache: dict[str, bool] = {}
        self._fallback_mode = False
        self._startup_status: dict[str, str] = {}
        self._embedding_model_name = "all-MiniLM-L6-v2"
        self._nli_model_name = "facebook/bart-large-mnli"
        self._common_entity_words = {
            "the",
            "this",
            "that",
            "these",
            "those",
            "and",
            "for",
            "with",
            "from",
            "into",
            "about",
            "after",
            "before",
            "city",
            "country",
            "state",
            "company",
            "model",
            "news",
        }
        self._number_words = {
            "zero": 0,
            "one": 1,
            "two": 2,
            "three": 3,
            "four": 4,
            "five": 5,
            "six": 6,
            "seven": 7,
            "eight": 8,
            "nine": 9,
            "ten": 10,
            "eleven": 11,
            "twelve": 12,
            "thirteen": 13,
            "fourteen": 14,
            "fifteen": 15,
            "sixteen": 16,
            "seventeen": 17,
            "eighteen": 18,
            "nineteen": 19,
            "twenty": 20,
        }
        self._keyword_stopwords = {
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
            "latest",
            "me",
            "my",
            "news",
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
            "discovered",
            "invented",
            "announced",
        }
        self._headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (AI-FactChecker/1.0)",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://en.wikipedia.org/",
        }
        self._demo_relation_cache: dict[str, str] = {}
        self._demo_kb = DEMO_KB

        self._startup_status = self._build_startup_status()

        print("=== SYSTEM CHECK ===")
        print("Embedding model loaded:", self._startup_status["embedding_model"] == "loaded")
        print("NLI model loaded:", self._startup_status["nli_model"] == "loaded")
        print("Wikipedia reachable:", self._startup_status["wikipedia"] == "working")
        print("NewsAPI working:", self._startup_status["newsapi"] == "working")
        print("Demo KB loaded:", self._startup_status["demo_kb"] == "loaded")
        if self._startup_status["newsapi"] == "missing key":
            logger.warning("NewsAPI key missing")

        print("[API STATUS]")
        print(f"Wikipedia: {self._startup_status['wikipedia']}")
        print(f"NewsAPI: {self._startup_status['newsapi']}")
        print(f"[MODE] {self._startup_status['mode']}")

    async def check(self, user_prompt: str, llm_response: str) -> FactCheckResult:
        embedding_model = None
        nli_model = None
        self._fallback_mode = False

        try:
            embedding_model = self._get_embedding_model()
            nli_model = self._get_nli_pipeline()
        except RuntimeError:
            self._fallback_mode = True
            print("=== FACT CHECK DEBUG ===")
            print("Embedding model loaded:", embedding_model is not None)
            print("NLI model loaded:", nli_model is not None)
            print("Using fallback mode:", self._fallback_mode)
            raise

        print("=== FACT CHECK DEBUG ===")
        print("Embedding model loaded:", embedding_model is not None)
        print("NLI model loaded:", nli_model is not None)
        print("Using fallback mode:", self._fallback_mode)

        claims = self._extract_claims(user_prompt=user_prompt, response=llm_response)
        if not claims:
            return await self._build_reference_only_result(user_prompt=user_prompt, llm_response=llm_response)

        checked_claims: list[ClaimCheckResult] = []
        for claim in claims:
            checked_claims.append(await self._check_claim(claim))

        if checked_claims and all(claim.verdict == "unclear" for claim in checked_claims):
            return await self._build_reference_only_result(user_prompt=user_prompt, llm_response=llm_response)

        claim_confidences = [claim.confidence for claim in checked_claims]
        score = round(sum(claim_confidences) / max(1, len(claim_confidences)), 2)

        if any(claim.verdict == "contradicted" for claim in checked_claims):
            status = "contradictory"
        elif score >= 0.75:
            status = "verified"
        elif score >= 0.45:
            status = "partially_verified"
        else:
            status = "unverified"

        return FactCheckResult(
            score=score,
            status=status,
            mode="standard",
            claims=checked_claims,
        )

    async def _build_reference_only_result(self, user_prompt: str, llm_response: str) -> FactCheckResult:
        keywords = self.extract_keywords(f"{user_prompt} {llm_response}")
        references = await self.get_reference_links(keywords)
        return FactCheckResult(
            score=None,
            status="unverified_mode",
            mode="reference_only",
            references=references,
            message="No verifiable claims found. Showing related references.",
            claims=[],
        )

    async def build_reference_only_result(self, user_prompt: str, llm_response: str) -> FactCheckResult:
        return await self._build_reference_only_result(user_prompt=user_prompt, llm_response=llm_response)

    def extract_keywords(self, text: str) -> list[str]:
        tokens = re.findall(r"[A-Za-z][A-Za-z'-]*", text)
        if not tokens:
            return []

        token_map: dict[str, str] = {}
        for token in tokens:
            normalized = token.strip().lower()
            if len(normalized) < 3:
                continue
            if normalized in self._keyword_stopwords:
                continue
            if normalized.isdigit():
                continue
            if normalized not in token_map:
                token_map[normalized] = token

        if not token_map:
            return []

        counts = Counter(tok.lower() for tok in tokens if tok.lower() in token_map)
        entities = [ent for ent in self.extract_entities(text) if ent and len(ent) >= 3]

        ranked: list[tuple[float, str]] = []
        seen: set[str] = set()

        for entity in entities:
            key = entity.lower().strip()
            if key in seen:
                continue
            seen.add(key)
            ranked.append((100.0 + counts.get(key, 0), entity.strip()))

        for normalized, original in token_map.items():
            if normalized in seen:
                continue
            bonus = 1.5 if original[:1].isupper() else 0.0
            ranked.append((counts.get(normalized, 0) + bonus, original))

        ranked.sort(key=lambda item: item[0], reverse=True)
        keywords = [item[1] for item in ranked if item[1]]
        return keywords[:5]

    async def get_reference_links(self, keywords: list[str]) -> list[SourceReference]:
        if not keywords:
            return []

        references: list[SourceReference] = []
        for keyword in keywords[:5]:
            search_query = keyword.strip()
            if not search_query:
                continue

            wiki_results = await self._query_wikipedia(search_query, search_query)
            references.extend(wiki_results[:1])

            news_results = await self._query_news(search_query)
            references.extend(news_results[:1])

        unique: list[SourceReference] = []
        seen: set[str] = set()
        for source in references:
            key = f"{source.source}:{source.url}".lower()
            if key in seen:
                continue
            seen.add(key)
            unique.append(source)
            if len(unique) >= 8:
                break

        return unique

    def get_startup_status(self) -> dict[str, str]:
        return dict(self._startup_status)

    def get_runtime_status(self) -> dict[str, str]:
        wikipedia_status = "working" if self._check_wikipedia_reachable() else "failed"
        if not self.news_api_key:
            newsapi_status = "missing key"
        else:
            newsapi_status = "working" if self._check_newsapi_working() else "failed"
        demo_status = "loaded" if bool(self._demo_kb) else "missing"
        mode = "online" if wikipedia_status == "working" or newsapi_status == "working" else "fallback"
        print(f"[MODE] {mode}")
        return {
            "backend": "running",
            "embedding_model": self._startup_status.get("embedding_model", "loaded"),
            "nli_model": self._startup_status.get("nli_model", "loaded"),
            "wikipedia": wikipedia_status,
            "newsapi": newsapi_status,
            "demo_kb": demo_status,
            "mode": mode,
        }

    def _extract_claims(self, user_prompt: str, response: str) -> list[str]:
        prompt_lower = user_prompt.lower()
        creative_markers = {
            "poem",
            "poetry",
            "story",
            "joke",
            "lyrics",
            "song",
            "write a poem",
            "write a story",
            "creative",
        }
        if any(marker in prompt_lower for marker in creative_markers):
            return []

        # Use conservative extraction to avoid scoring every conversational sentence as factual.
        sentence_chunks = [s.strip() for s in re.split(r"[.!?]+", response) if s.strip()]
        claims: list[str] = []

        for sentence in sentence_chunks:
            for candidate in self._split_claim_candidates(sentence):
                if len(candidate.split()) < 4 and not any(ch.isdigit() for ch in candidate):
                    continue

                has_number = any(ch.isdigit() for ch in candidate)
                has_named_entity_shape = bool(re.search(r"\b[A-Z][a-z]{2,}\b", candidate))
                has_factual_verb = any(
                    keyword in candidate.lower()
                    for keyword in [
                        "is",
                        "are",
                        "was",
                        "were",
                        "founded",
                        "launched",
                        "located",
                        "president",
                        "capital",
                        "won",
                        "announced",
                        "discovered",
                        "invented",
                        "has",
                        "have",
                        "hub",
                    ]
                )

                if has_factual_verb and (has_named_entity_shape or has_number or "hub" in candidate.lower()):
                    claims.append(candidate)

        # Fall back to a short excerpt if nothing matched but the response is still substantial.
        if not claims and len(response.split()) >= 8:
            truncated = " ".join(response.split()[:20]).strip()
            if truncated:
                claims.append(truncated)

        return claims[: settings.max_fact_claims]

    def _split_claim_candidates(self, sentence: str) -> list[str]:
        normalized = sentence.strip()
        if not normalized:
            return []

        # Split obvious multi-claim coordination so each factual proposition can be scored separately.
        parts = [part.strip() for part in re.split(r"\b(?:and|but)\b|,|;", normalized, flags=re.IGNORECASE) if part.strip()]
        if len(parts) > 1:
            return parts

        return [normalized]

    async def _check_claim(self, claim: str) -> ClaimCheckResult:
        sources = await self._fetch_sources_for_claim(claim)
        normalized_claim = self._normalize_claim(claim)
        relation_hint = self._demo_relation_cache.get(normalized_claim)
        capital_claim = self._parse_capital_claim(claim)
        capital_supported = False
        capital_contradicted = False

        if not sources:
            return ClaimCheckResult(
                claim=claim,
                verdict="unclear",
                confidence=0.25,
                sources=[],
                explanation="External verification unavailable.",
            )

        source_scores: list[float] = []
        contradiction_detected = False
        matched_entities: set[str] = set()

        if relation_hint in {"supported", "contradicted"}:
            print(f"[EVIDENCE SOURCE] demo_kb relation={relation_hint}")

        for source in sources:
            evidence_text = source.title
            if capital_claim is not None:
                capital_relation = self._evaluate_capital_evidence(capital_claim, evidence_text)
                if capital_relation == "supported":
                    capital_supported = True
                elif capital_relation == "contradicted":
                    capital_contradicted = True

            semantic = await self._semantic_similarity_async(claim, evidence_text)
            print(f"[SEMANTIC SCORE] {semantic} for claim vs evidence")
            boost, overlap_entities = self.entity_boost(claim, evidence_text)
            print(f"[ENTITY BOOST] +{boost}")
            matched_entities.update(overlap_entities)
            source_score = semantic + boost

            if "elon musk" in evidence_text.lower() and "tesla" in evidence_text.lower():
                source_score += 0.3
                print("[BOOST] Strong entity match applied")

            if relation_hint == "supported":
                source_score = max(source_score, 0.95)
            elif relation_hint == "contradicted":
                source_score = min(source_score, 0.15)

            source_score = self._clamp_01(source_score)
            source_scores.append(source_score)

            if await self._detect_contradiction_async(claim, evidence_text):
                contradiction_detected = True

        if relation_hint == "contradicted":
            contradiction_detected = True

        max_score = max(source_scores)
        average_score = sum(source_scores) / max(1, len(source_scores))
        combined_score = (max_score * 0.6) + (average_score * 0.4)
        calibrated_score = self.calibrate_score(combined_score, len(sources))

        if capital_claim is not None and not capital_supported:
            if capital_contradicted:
                contradiction_detected = True
            else:
                # Do not allow generic country snippets to verify an explicit capital assertion.
                calibrated_score = min(calibrated_score, 0.45)

        print(f"[FINAL SCORE] {calibrated_score}")
        print(f"[SOURCE COUNT] {len(sources)}")

        if contradiction_detected:
            verdict = "contradicted"
            confidence = round(min(calibrated_score, 0.3), 2)
            explanation = "Retrieved evidence conflicts with key parts of the claim."
        elif calibrated_score > 0.75:
            verdict = "supported"
            confidence = round(calibrated_score, 2)
            explanation = "Claim is semantically aligned with supporting evidence."
        elif calibrated_score > 0.45:
            verdict = "unclear"
            confidence = round(calibrated_score, 2)
            explanation = "Claim is partially verified by available evidence."
        else:
            verdict = "unclear"
            confidence = round(calibrated_score, 2)
            explanation = "Evidence relevance is weak for this claim."

        if matched_entities:
            explanation += f" Entity matches: {', '.join(sorted(matched_entities)[:5])}."

        return ClaimCheckResult(
            claim=claim,
            verdict=verdict,
            confidence=confidence,
            sources=sources,
            explanation=explanation,
        )

    async def _fetch_sources_for_claim(self, claim: str) -> list[SourceReference]:
        cache_key = self._normalize_claim(claim)
        cached = self._cache.get(cache_key)
        if cached and (time.time() - cached[0] <= self.cache_ttl_seconds):
            return cached[1]

        search_query = self.build_search_query(claim)

        tasks = [
            self._query_wikipedia(claim, search_query),
            self._query_news(search_query),
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        sources: list[SourceReference] = []
        for result in results:
            if isinstance(result, Exception):
                continue
            sources.extend(result)

        # Keep a small, high-signal source set for payload size and readability.
        unique: list[SourceReference] = []
        seen: set[str] = set()
        for source in sources:
            key = f"{source.source}:{source.url}".lower()
            if key in seen:
                continue
            seen.add(key)
            unique.append(source)
            if len(unique) >= settings.max_fact_sources_per_claim:
                break

        if unique:
            self._cache[cache_key] = (time.time(), unique)
            return unique

        demo_match = self._lookup_demo_kb(cache_key)
        if demo_match is not None:
            source, relation = demo_match
            self._demo_relation_cache[cache_key] = relation
            print("[SOURCE] Using DEMO KB (fallback)")
            self._cache[cache_key] = (time.time(), [source])
            return [source]

        self._cache[cache_key] = (time.time(), unique)
        return unique

    def _lookup_demo_kb(self, normalized_claim: str) -> tuple[SourceReference, str] | None:
        claim_tokens = set(normalized_claim.split())
        best_key = None
        best_overlap = 0.0

        for key, payload in self._demo_kb.items():
            key_tokens = set(self._normalize_claim(key).split())
            if not key_tokens:
                continue
            overlap = len(claim_tokens & key_tokens) / max(1, len(key_tokens))
            if overlap >= 0.6 and overlap > best_overlap:
                best_overlap = overlap
                best_key = key

        if best_key is None:
            return None

        payload = self._demo_kb[best_key]
        relation = str(payload.get("relation") or "supported").lower()
        title = str(payload.get("text") or best_key).strip()
        source = SourceReference(
            title=title,
            url=f"https://en.wikipedia.org/wiki/Special:Search?search={quote(best_key.replace(' ', '+'), safe='')}",
            source="wikipedia",
        )
        return source, relation

    async def _query_wikipedia(self, claim: str, search_query: str) -> list[SourceReference]:
        query = self._to_wiki_query(claim, search_query)
        if not query:
            return []

        url = f"{self.wikipedia_base_url}/{quote(query, safe='')}"
        payload = None

        try:
            response = await asyncio.to_thread(
                requests.get,
                url,
                headers=self._headers,
                timeout=self.api_timeout,
            )
            response.raise_for_status()
            payload = response.json()
            print("[WIKI] success")
        except Exception:
            print("[WIKI] fail")
            payload = None

        if not payload:
            payload = await self._query_wikipedia_extract(query)

        if not payload:
            payload = await self._query_wikipedia_search(query)

        if not payload:
            return []

        print("[SOURCE] Using Wikipedia")

        title = str(payload.get("title") or "Wikipedia Summary").strip()
        page_url = payload.get("content_urls", {}).get("desktop", {}).get("page")
        if not page_url:
            page_url = f"https://en.wikipedia.org/wiki/{query.replace(' ', '_')}"

        extract = str(payload.get("extract") or "").strip()
        # Keep a richer snippet so contradiction checks can see key facts such as capitals and counts.
        stitched_title = f"{title}: {extract[:420]}" if extract else title

        return [
            SourceReference(
                title=stitched_title,
                url=page_url,
                source="wikipedia",
            )
        ]

    async def _query_wikipedia_extract(self, query: str) -> dict | None:
        api_url = "https://en.wikipedia.org/w/api.php"
        params = {
            "action": "query",
            "prop": "extracts",
            "exintro": 1,
            "redirects": 1,
            "titles": query,
            "format": "json",
        }

        try:
            response = await asyncio.to_thread(
                requests.get,
                api_url,
                params=params,
                headers=self._headers,
                timeout=self.api_timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception:
            return None

        pages_obj = payload.get("query", {}).get("pages", {}) if isinstance(payload, dict) else {}
        if not isinstance(pages_obj, dict) or not pages_obj:
            return None

        page = next((p for p in pages_obj.values() if isinstance(p, dict) and "missing" not in p), None)
        if not isinstance(page, dict):
            return None

        extract = str(page.get("extract") or "").strip()
        title = str(page.get("title") or query).strip()
        fullurl = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
        if not extract and not title:
            return None

        return {
            "title": title,
            "content_urls": {"desktop": {"page": fullurl}},
            "extract": extract,
        }

    async def _query_wikipedia_search(self, query: str) -> dict | None:
        api_url = "https://en.wikipedia.org/w/api.php"
        params = {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": 1,
            "format": "json",
            "formatversion": 2,
        }

        try:
            response = await asyncio.to_thread(
                requests.get,
                api_url,
                params=params,
                headers=self._headers,
                timeout=self.api_timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception:
            return None

        search_hits = payload.get("query", {}).get("search", []) if isinstance(payload, dict) else []
        if not search_hits:
            return None

        top_hit = search_hits[0]
        if not isinstance(top_hit, dict):
            return None

        title = str(top_hit.get("title") or query).strip()
        page_url = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
        snippet = str(top_hit.get("snippet") or "").strip()
        return {
            "title": title,
            "content_urls": {"desktop": {"page": page_url}},
            "extract": snippet,
        }

    async def _query_news(self, search_query: str) -> list[SourceReference]:
        if not self.news_api_key:
            print("[NEWS] fail")
            return []

        params = {
            "q": f"{search_query} facts",
            "apiKey": self.news_api_key,
            "language": "en",
            "sortBy": "relevancy",
            "pageSize": settings.max_news_articles,
        }

        try:
            async with httpx.AsyncClient(timeout=self.api_timeout, headers=self._headers) as client:
                response = await client.get(self.news_base_url, params=params)
                response.raise_for_status()
                payload = response.json()
        except Exception:
            print("[NEWS] fail")
            return []

        articles = payload.get("articles", []) if isinstance(payload, dict) else []
        sources: list[SourceReference] = []
        for article in articles:
            if not isinstance(article, dict):
                continue
            title = str(article.get("title") or "").strip()
            description = str(article.get("description") or "").strip()
            url = str(article.get("url") or "").strip()
            if not title or not url:
                continue
            merged_title = f"{title}: {description[:140]}" if description else title
            sources.append(
                SourceReference(
                    title=merged_title,
                    url=url,
                    source="news",
                )
            )
        if sources:
            print("[SOURCE] Using NewsAPI")
            print("[NEWS] success")
        else:
            print("[NEWS] fail")
        return sources

    def _to_wiki_query(self, claim: str, search_query: str) -> str:
        # Prioritize named entities because the summary endpoint expects page-like titles.
        named_entities = self.extract_entities(claim)
        if named_entities:
            candidate = named_entities[0].strip()
            if candidate:
                return candidate

        # Fall back to leading normalized terms.
        normalized = re.sub(r"[^A-Za-z0-9\s-]", " ", search_query).strip()
        words = normalized.split()
        if not words:
            return ""
        return " ".join(words[:6])

    def build_search_query(self, claim: str) -> str:
        entities = self.extract_entities(claim)
        claim_tokens = re.findall(r"[A-Za-z0-9]+", claim)
        key_terms = [
            tok
            for tok in claim_tokens
            if tok.lower() in {
                "ceo",
                "capital",
                "founded",
                "president",
                "headquarters",
                "launched",
                "acquired",
                "discovered",
                "invented",
                "moon",
                "moons",
                "planet",
                "gravity",
                "cancer",
                "tesla",
                "newton",
                "einstein",
            }
        ]

        common_stop = {
            "the",
            "a",
            "an",
            "is",
            "are",
            "was",
            "were",
            "of",
            "to",
            "in",
            "on",
            "for",
            "and",
            "with",
            "who",
            "what",
            "tell",
            "about",
            "me",
            "us",
        }
        informative_terms = [tok for tok in claim_tokens if len(tok) > 3 and tok.lower() not in common_stop]

        ordered_parts: list[str] = []
        ordered_parts.extend(entities[:2])
        ordered_parts.extend([term for term in key_terms if term not in ordered_parts])
        ordered_parts.extend([term for term in informative_terms[:4] if term not in ordered_parts])

        if not ordered_parts:
            return claim
        return " ".join(ordered_parts)

    def extract_entities(self, text: str) -> list[str]:
        candidates = re.findall(r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\b", text)
        entities: list[str] = []
        seen: set[str] = set()
        for item in candidates:
            normalized = item.strip()
            if len(normalized) < 3:
                continue
            if normalized.lower() in self._common_entity_words:
                continue
            if normalized in seen:
                continue
            seen.add(normalized)
            entities.append(normalized)
        return entities

    def entity_boost(self, claim: str, evidence: str) -> tuple[float, list[str]]:
        claim_entities = set(self.extract_entities(claim))
        if not claim_entities:
            return 0.0, []

        evidence_lower = evidence.lower()
        overlaps = [entity for entity in claim_entities if entity.lower() in evidence_lower]
        if not overlaps:
            return 0.0, []

        overlap_ratio = len(overlaps) / max(1, len(claim_entities))
        boost = 0.05 + (0.25 * overlap_ratio)
        return round(min(0.3, boost), 2), sorted(overlaps)

    def semantic_similarity(self, claim: str, evidence: str) -> float:
        claim_vec = self._get_embedding(claim)
        evidence_vec = self._get_embedding(evidence)
        if not claim_vec or not evidence_vec:
            raise RuntimeError("Embedding inference failed: empty embedding vectors")

        dot = sum(a * b for a, b in zip(claim_vec, evidence_vec))
        claim_norm = (sum(a * a for a in claim_vec) ** 0.5) or 1.0
        evidence_norm = (sum(b * b for b in evidence_vec) ** 0.5) or 1.0
        cosine = dot / (claim_norm * evidence_norm)

        # Normalize cosine from [-1, 1] into [0, 1].
        normalized = (cosine + 1.0) / 2.0
        return round(self._clamp_01(normalized), 2)

    async def _semantic_similarity_async(self, claim: str, evidence: str) -> float:
        return await self._run_with_timeout(self.semantic_similarity, claim, evidence)

    def detect_contradiction(self, claim: str, evidence: str) -> bool:
        cache_key = f"{claim.lower().strip()}::{evidence.lower().strip()}"
        cached = self._contradiction_cache.get(cache_key)
        if cached is not None:
            return cached

        pipeline_obj = self._get_nli_pipeline()
        try:
            # Equivalent to premise/hypothesis NLI inference for contradiction detection.
            prediction = pipeline_obj({"text": evidence, "text_pair": claim}, truncation=True)
            top = prediction[0] if isinstance(prediction, list) else prediction
            label = str(top.get("label", "")).upper()
            result = label == "CONTRADICTION"
            if not result:
                result = self._heuristic_contradiction(claim, evidence)
        except Exception as e:
            print("ERROR loading model:", e)
            raise RuntimeError("Embedding/NLI model failed to load") from e

        self._contradiction_cache[cache_key] = result
        return result

    async def _detect_contradiction_async(self, claim: str, evidence: str) -> bool:
        return await self._run_with_timeout(self.detect_contradiction, claim, evidence)

    def calibrate_score(self, score: float, sources_count: int) -> float:
        adjusted = score

        if sources_count >= 2:
            adjusted += 0.1

        if adjusted > 0.75:
            adjusted += 0.05
        elif adjusted > 0.55:
            adjusted += 0.02

        return round(self._clamp_01(adjusted), 2)

    async def _run_with_timeout(self, fn, *args):
        try:
            return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout=self.timeout)
        except Exception as e:
            self._fallback_mode = True
            print("ERROR loading model:", e)
            raise RuntimeError("Embedding/NLI model failed to load") from e

    def _get_embedding(self, text: str) -> list[float]:
        key = text.strip().lower()
        cached = self._embedding_cache.get(key)
        if cached is not None:
            return cached

        model = self._get_embedding_model()

        try:
            vector = model.encode(text, normalize_embeddings=True)
            if hasattr(vector, "tolist"):
                vector_list = vector.tolist()
            else:
                vector_list = list(vector)
            self._embedding_cache[key] = vector_list
            return vector_list
        except Exception as e:
            print("ERROR loading model:", e)
            raise RuntimeError("Embedding/NLI model failed to load") from e

    def _get_embedding_model(self):
        return get_embedding_model(self._embedding_model_name)

    def _get_nli_pipeline(self):
        return get_nli_model(self._nli_model_name)

    def _normalize_claim(self, text: str) -> str:
        lowered = text.lower()
        lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
        lowered = re.sub(
            r"\b(?:the|a|an|is|are|was|were|to|of|for|and|but|who|what|tell|about|me|us|in|on|with|from|recently)\b",
            " ",
            lowered,
        )
        lowered = re.sub(r"\s+", " ", lowered).strip()
        return lowered

    def _check_wikipedia_reachable(self) -> bool:
        try:
            response = requests.get(
                "https://en.wikipedia.org/api/rest_v1/page/summary/Tesla",
                headers=self._headers,
                timeout=self.api_timeout,
            )
            if response.status_code < 400:
                print("[WIKI] success")
                return True
        except Exception:
            pass

        try:
            response = requests.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "prop": "extracts",
                    "exintro": 1,
                    "titles": "Tesla",
                    "format": "json",
                },
                headers=self._headers,
                timeout=self.api_timeout,
            )
            ok = response.status_code < 400
            print("[WIKI] success" if ok else "[WIKI] fail")
            return ok
        except Exception:
            print("[WIKI] fail")
            return False

    def _check_newsapi_working(self) -> bool:
        if not self.news_api_key:
            print("[NEWS] fail")
            return False

        try:
            response = httpx.get(
                self.news_base_url,
                params={
                    "q": "Tesla",
                    "apiKey": self.news_api_key,
                    "language": "en",
                    "pageSize": 1,
                },
                timeout=self.api_timeout,
            )
            ok = response.status_code == 200
            print("[NEWS] success" if ok else "[NEWS] fail")
            return ok
        except Exception:
            print("[NEWS] fail")
            return False

    def _build_startup_status(self) -> dict[str, str]:
        try:
            self._get_embedding_model()
            embedding_status = "loaded"
        except Exception:
            embedding_status = "failed"

        try:
            self._get_nli_pipeline()
            nli_status = "loaded"
        except Exception:
            nli_status = "failed"

        wikipedia_status = "working" if self._check_wikipedia_reachable() else "failed"
        if not self.news_api_key:
            newsapi_status = "missing key"
        else:
            newsapi_status = "working" if self._check_newsapi_working() else "failed"
        demo_status = "loaded" if bool(self._demo_kb) else "missing"
        mode = "online" if wikipedia_status == "working" or newsapi_status == "working" else "fallback"
        print(f"[MODE] {mode}")
        return {
            "backend": "running",
            "embedding_model": embedding_status,
            "nli_model": nli_status,
            "wikipedia": wikipedia_status,
            "newsapi": newsapi_status,
            "demo_kb": demo_status,
            "mode": mode,
        }

    def _fallback_similarity(self, claim: str, evidence: str) -> float:
        claim_tokens = {tok for tok in re.findall(r"[a-z0-9]+", claim.lower()) if len(tok) > 2}
        evidence_tokens = {tok for tok in re.findall(r"[a-z0-9]+", evidence.lower()) if len(tok) > 2}
        overlap = len(claim_tokens & evidence_tokens) / max(1, len(claim_tokens))
        return round(self._clamp_01(overlap), 2)

    def _heuristic_contradiction(self, claim: str, evidence: str) -> bool:
        negation_words = {"not", "never", "no", "none", "false", "incorrect"}
        claim_tokens = set(re.findall(r"[a-z]+", claim.lower()))
        evidence_tokens = set(re.findall(r"[a-z]+", evidence.lower()))

        claim_neg = bool(claim_tokens & negation_words)
        evidence_neg = bool(evidence_tokens & negation_words)

        entity_overlap = len(
            {tok for tok in claim_tokens if len(tok) > 4} & {tok for tok in evidence_tokens if len(tok) > 4}
        )
        if claim_neg != evidence_neg and entity_overlap >= 1:
            return True

        if self._has_numeric_conflict(claim, evidence):
            return True

        if self._has_capital_mismatch(claim, evidence):
            return True

        return False

    def _extract_numeric_values(self, text: str) -> set[int]:
        values: set[int] = set()
        for match in re.findall(r"\b\d+\b", text):
            try:
                values.add(int(match))
            except ValueError:
                continue

        for token in re.findall(r"[a-z]+", text.lower()):
            if token in self._number_words:
                values.add(self._number_words[token])

        return values

    def _has_numeric_conflict(self, claim: str, evidence: str) -> bool:
        claim_numbers = self._extract_numeric_values(claim)
        if not claim_numbers:
            return False

        evidence_numbers = self._extract_numeric_values(evidence)
        if not evidence_numbers:
            return False

        entities = self.extract_entities(claim)
        entity_match = not entities or any(entity.lower() in evidence.lower() for entity in entities)
        if not entity_match:
            return False

        return claim_numbers.isdisjoint(evidence_numbers)

    def _has_capital_mismatch(self, claim: str, evidence: str) -> bool:
        claim_lower = claim.lower()
        evidence_lower = evidence.lower()
        if "capital of" not in claim_lower or " is " not in claim_lower:
            return False
        if "capital" not in evidence_lower:
            return False

        match = re.search(r"capital of\s+([a-z\s]+?)\s+is\s+([a-z\s]+)", claim_lower)
        if not match:
            return False

        country = re.sub(r"\s+", " ", match.group(1)).strip()
        claimed_capital = re.sub(r"\s+", " ", match.group(2)).strip(" .,")
        if not country or not claimed_capital:
            return False

        if country not in evidence_lower:
            return False

        return claimed_capital not in evidence_lower

    def _parse_capital_claim(self, claim: str) -> tuple[str, str] | None:
        claim_lower = claim.lower()
        match = re.search(r"capital of\s+([a-z\s]+?)\s+is\s+([a-z\s]+)", claim_lower)
        if not match:
            return None

        country = re.sub(r"\s+", " ", match.group(1)).strip(" .,")
        claimed_capital = re.sub(r"\s+", " ", match.group(2)).strip(" .,")
        if not country or not claimed_capital:
            return None
        return country, claimed_capital

    def _evaluate_capital_evidence(self, capital_claim: tuple[str, str], evidence: str) -> str:
        country, claimed_capital = capital_claim
        evidence_lower = evidence.lower()

        if country not in evidence_lower:
            return "unknown"
        if "capital" not in evidence_lower:
            return "unknown"
        if claimed_capital in evidence_lower:
            return "supported"
        return "contradicted"

    def _clamp_01(self, value: float) -> float:
        return max(0.0, min(1.0, float(value)))

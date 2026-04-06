from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv


ENV_FILE = Path(".env")
if not ENV_FILE.exists():
    ENV_FILE.write_text(
        "\n".join(
            [
                "APP_NAME=SafeNet AI Governance API",
                "APP_ENV=dev",
                "APP_PORT=8000",
                "OLLAMA_BASE_URL=http://localhost:11434",
                "OLLAMA_MODEL=llama3:8b",
                "REQUEST_TIMEOUT_SECONDS=40",
                "NEWS_API_KEY=your_api_key_here",
                "FACT_CHECK_TIMEOUT_SECONDS=12",
                "FACT_CHECK_CACHE_TTL_SECONDS=600",
                "MAX_FACT_CLAIMS=5",
                "MAX_FACT_SOURCES_PER_CLAIM=4",
                "MAX_NEWS_ARTICLES=3",
                "VITE_API_BASE_URL=http://127.0.0.1:8001",
                "",
            ]
        ),
        encoding="utf-8",
    )


load_dotenv()


class Settings(BaseSettings):
    app_name: str = "SafeNet AI Governance API"
    app_env: str = "dev"
    app_port: int = 8000

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3:8b"
    request_timeout_seconds: int = 40

    news_api_key: str = ""
    fact_check_timeout_seconds: int = 12
    fact_check_cache_ttl_seconds: int = 600
    max_fact_claims: int = 5
    max_fact_sources_per_claim: int = 4
    max_news_articles: int = 3

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

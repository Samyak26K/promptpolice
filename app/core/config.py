from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SafeNet AI Governance API"
    app_env: str = "dev"
    app_port: int = 8000

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3:latest"
    request_timeout_seconds: int = 40

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

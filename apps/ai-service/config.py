"""Validated settings for the AI service (ARCHITECTURE.md §5, §18).

Mirrors the fail-fast philosophy of the Node API's env.ts: pydantic-settings loads
and type-checks configuration at import time, so a misconfigured service refuses to
start rather than failing mid-inference.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_env: str = Field(default="development")
    ai_port: int = Field(default=8000)

    # Shared secret authenticating the Node API → this internal service.
    ai_service_api_key: str = Field(default="CHANGE_ME_INTERNAL_KEY")

    # Where completed analysis results are POSTed back to.
    callback_api_url: str = Field(default="http://localhost:3001/api/v1")

    whisper_model: str = Field(default="large-v3")
    mert_model: str = Field(default="m-a-p/MERT-v1-95M")
    pitch_confidence_threshold: float = Field(default=0.80, ge=0.0, le=1.0)

    wandb_api_key: str = Field(default="")

    @property
    def is_production(self) -> bool:
        return self.ai_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Cached accessor so settings are parsed exactly once per process."""
    return Settings()

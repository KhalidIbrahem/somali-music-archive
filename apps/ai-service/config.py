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
    # Inference device: "" = auto-detect (MPS on Apple Silicon → CUDA → CPU).
    whisper_device: str = Field(default="")
    mert_model: str = Field(default="m-a-p/MERT-v1-95M")
    pitch_confidence_threshold: float = Field(default=0.80, ge=0.0, le=1.0)

    # Job queue: Celery (Redis broker) in production; FastAPI BackgroundTasks
    # when False so development needs no Redis (ADR-0005 seam, same pipeline fn).
    use_celery: bool = Field(default=False)
    celery_broker_url: str = Field(default="redis://localhost:6379/0")

    sentry_dsn: str = Field(default="")
    wandb_api_key: str = Field(default="")

    # Track B notation pipeline: basic-pitch requires Python <=3.11, so
    # transcription runs as a subprocess under this interpreter.
    transcribe_python: str = Field(default="/opt/anaconda3/envs/somali311/bin/python")
    # Demucs vocal separation (notation opt-in). Empty = this service's own
    # interpreter (sys.executable) — demucs+torch live in the base env here.
    demucs_python: str = Field(default="")
    # CREPE vocal engine (scripts/vocal_f0.py) — needs torch+torchcrepe.
    # Empty = sys.executable, same rationale as demucs_python.
    vocal_python: str = Field(default="")

    # Track A generation gate: stays False until the Phase 0 license_status
    # table (data/manifest.csv — currently all 'unknown') permits exposure.
    generation_enabled: bool = Field(default=False)

    @property
    def is_production(self) -> bool:
        return self.ai_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Cached accessor so settings are parsed exactly once per process."""
    return Settings()

"""Model registry — lazy, cached loaders for the heavy ML models.

Loading a large model (Whisper large-v3, MERT-v1-95M) takes seconds and gigabytes,
so each is loaded once on first use and cached. Imports of torch/whisper/transformers
happen INSIDE the loaders, so importing this module (or the routers that reference it)
never pulls the ML stack — the pure unit tests stay fast and dependency-light.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from config import get_settings


def get_whisper() -> Any:
    """Load and cache the Whisper model (ARCHITECTURE.md §10).

    Delegates to models.whisper_model — the canonical loader with device
    selection (MPS/CUDA/CPU) and graceful fallback — so there is exactly one
    loading path in the codebase.
    """
    from models.whisper_model import get_whisper_model

    return get_whisper_model()


@lru_cache
def _get_mert() -> tuple[Any, Any]:
    """Load and cache the MERT model + processor."""
    import torch  # noqa: F401  (imported to ensure the runtime is present)
    from transformers import AutoModel, AutoProcessor  # type: ignore[import-untyped]

    settings = get_settings()
    processor = AutoProcessor.from_pretrained(settings.mert_model, trust_remote_code=True)
    model = AutoModel.from_pretrained(settings.mert_model, trust_remote_code=True)
    model.eval()
    return model, processor


def generate_embedding(audio_path: str) -> list[float]:
    """Produce a 768-dim MERT embedding for the audio at ``audio_path`` (§10)."""
    import librosa
    import torch

    model, processor = _get_mert()
    audio, sr = librosa.load(audio_path, sr=24000, mono=True)
    inputs = processor(audio, sampling_rate=sr, return_tensors="pt")

    with torch.no_grad():
        outputs = model(**inputs, output_hidden_states=True)

    # Mean over time, then over layers — captures multi-level musical features.
    all_hidden = torch.stack(outputs.hidden_states).squeeze()
    time_averaged = all_hidden.mean(dim=-2)
    embedding = time_averaged.mean(dim=0)
    return embedding.tolist()

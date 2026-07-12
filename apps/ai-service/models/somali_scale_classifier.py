"""Somali scale-degree classifier — lightweight CNN on 1-second audio (Phase E3).

Predicts which Somali pentatonic scale degree (do/re/mi/sol/la) dominates a
one-second audio window, plus an explicit `unvoiced` class for silence,
percussion-only, and speech. To our knowledge this is the first scale-degree
model for any East African musical tradition.

Design constraints, in order:
  1. REAL-TIME CAPABLE — the mobile app wants live feedback while a user
     plays the oud, so the model is ~100k parameters and consumes raw 16 kHz
     waveforms (no mel front-end to compute on-device).
  2. HONEST ABOUT SILENCE — a 5-class model forced to answer "which degree?"
     on an unvoiced window would fabricate one; the 6th class is the escape.

Training labels come from CREPE + the canonical scale map (utils/scale_mapping)
run over the corpus: windows whose modal mapped degree holds ≥60% of voiced
frames are labelled with that degree — machine labels audited by ear before
any accuracy claim (see evaluation/evaluate_model.py).
"""

from __future__ import annotations

import torch
from torch import Tensor, nn

from services.scale import SOMALI_SCALE_HZ

# Index IS the class id. Scale degrees first (in canonical scale order),
# `unvoiced` last — appended classes never renumber the musical ones.
SCALE_DEGREE_LABELS: tuple[str, ...] = (*SOMALI_SCALE_HZ.keys(), "unvoiced")

SAMPLE_RATE = 16_000
WINDOW_SEC = 1.0
WINDOW_SAMPLES = int(SAMPLE_RATE * WINDOW_SEC)


class SomaliScaleClassifier(nn.Module):
    """1-D CNN: raw 16 kHz mono window → scale-degree logits.

    Strided Conv1d stacks stand in for a learnable filterbank (the CREPE
    trick, scaled down ~20×): the first layer's 64-sample kernels (4 ms) are
    wide enough to resolve the fundamental of the lowest scale degree
    (do ≈ 294 Hz ⇒ period ≈ 54 samples at 16 kHz).
    """

    def __init__(
        self,
        n_classes: int = len(SCALE_DEGREE_LABELS),
        dropout: float = 0.25,
    ) -> None:
        super().__init__()
        self.n_classes = n_classes
        self.encoder = nn.Sequential(
            nn.Conv1d(1, 32, kernel_size=64, stride=4, padding=32),
            nn.BatchNorm1d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(4),
            nn.Conv1d(32, 64, kernel_size=16, stride=2, padding=8),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(4),
            nn.Conv1d(64, 128, kernel_size=8, stride=2, padding=4),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
        )
        self.pool = nn.AdaptiveAvgPool1d(1)
        self.head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(128, n_classes),
        )

    def forward(self, waveform: Tensor) -> Tensor:
        """Logits of shape (batch, n_classes) from (batch, samples) or
        (batch, 1, samples) raw audio at 16 kHz."""
        if waveform.dim() == 2:
            waveform = waveform.unsqueeze(1)
        x = self.encoder(waveform)
        x = self.pool(x).flatten(1)
        return self.head(x)

    @torch.no_grad()
    def predict(self, waveform: Tensor) -> tuple[list[str], Tensor]:
        """Human-readable predictions: (degree_names, per-class probabilities)."""
        self.eval()
        probs = torch.softmax(self.forward(waveform), dim=-1)
        indices = probs.argmax(dim=-1)
        return [SCALE_DEGREE_LABELS[int(i)] for i in indices], probs

    def parameter_count(self) -> int:
        """Trainable parameter count — asserted small in tests to keep the
        real-time constraint from silently regressing."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)

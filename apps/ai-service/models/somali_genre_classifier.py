"""Somali genre classifier — CNN over mel spectrograms (Phase E2).

Classifies a Somali traditional recording into one of four genres:
heello, qaraami, dhaanto, praise_song. To our knowledge this is the first
genre model for any Somali musical tradition, so the architecture is kept
deliberately conventional (stacked conv blocks + global pooling, the shape
proven by CREPE and a decade of audio-tagging work): the *dataset* is the
novel contribution, and a boring, reproducible baseline is what a dataset
paper needs.

The model consumes precomputed log-mel spectrograms (128 mel bins), NOT raw
audio — feature extraction lives in scripts/train_somali_model.py so this
module imports only torch and stays unit-testable without librosa/ffmpeg.
"""

from __future__ import annotations

import torch
from torch import Tensor, nn

# Canonical label order — index IS the class id everywhere (training,
# evaluation, inference). Append only; never reorder after a model ships.
GENRE_LABELS: tuple[str, ...] = ("heello", "qaraami", "dhaanto", "praise_song")

N_MEL_BINS = 128


class ConvBlock(nn.Module):
    """Conv → BatchNorm → ReLU → MaxPool, the standard audio-tagging unit.

    BatchNorm before ReLU (not after) because cassette-era spectrograms have
    wildly varying dynamic ranges between tracks; normalizing pre-activation
    keeps early training stable on small batches.
    """

    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2),
        )

    def forward(self, x: Tensor) -> Tensor:
        return self.block(x)


class SomaliGenreClassifier(nn.Module):
    """4-block CNN over (batch, 1, n_mels, time) log-mel spectrograms.

    Global average pooling (not flatten) so the model accepts variable-length
    spectrograms — corpus tracks run from 90 s to 30+ minutes and training
    crops need not match inference lengths.
    """

    def __init__(
        self,
        n_genres: int = len(GENRE_LABELS),
        n_mels: int = N_MEL_BINS,
        dropout: float = 0.3,
    ) -> None:
        super().__init__()
        self.n_genres = n_genres
        self.n_mels = n_mels
        self.features = nn.Sequential(
            ConvBlock(1, 32),
            ConvBlock(32, 64),
            ConvBlock(64, 128),
            ConvBlock(128, 256),
        )
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(256, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(128, n_genres),
        )

    def forward(self, mel_spectrogram: Tensor) -> Tensor:
        """Logits of shape (batch, n_genres) from (batch, 1, n_mels, time)."""
        if mel_spectrogram.dim() == 3:  # tolerate a missing channel dim
            mel_spectrogram = mel_spectrogram.unsqueeze(1)
        x = self.features(mel_spectrogram)
        x = self.pool(x).flatten(1)
        return self.classifier(x)

    @torch.no_grad()
    def predict(self, mel_spectrogram: Tensor) -> tuple[list[str], Tensor]:
        """Human-readable predictions: (genre_names, per-class probabilities)."""
        self.eval()
        probs = torch.softmax(self.forward(mel_spectrogram), dim=-1)
        indices = probs.argmax(dim=-1)
        return [GENRE_LABELS[int(i)] for i in indices], probs

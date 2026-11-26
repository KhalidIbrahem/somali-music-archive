"""Put one run of portfolio_dsp_demo.py on the public Separation page.

    python -m scripts.portfolio_dsp_build --demo <dir> --source synthetic
    python -m scripts.portfolio_dsp_build --demo <dir> --source recording \
        --performer "Khalid Ibrahim" --consent "<index entry in docs/data/consent/README.md>" \
        --piece "Beerdilaacshe melody, solo oud" [--demucs]

`<dir>` holds the WAVs and metrics.json written by portfolio_dsp_demo.py.

Output, all under apps/web/:
  public/demos/dsp/<clip>.mp3 and <clip>.png   (audio and its spectrogram)
  lib/dsp-demo.json                            (what the page renders)
  public-audio-rights.json                     (one entry per audio file)

Every clip of one block is encoded with no loudness change, so the extracted
parts still add up to the mixture a listener just heard. `--source recording`
needs a performer and a consent reference: the rights gate refuses a recording
without both. `--demucs` scores a pretrained Demucs on the same mixture as the
reference baseline (it needs the model on this machine).
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from scripts.portfolio_dsp import SR, si_sdr

REPO = Path(__file__).resolve().parents[3]
WEB = REPO / "apps" / "web"
OUT = WEB / "public" / "demos" / "dsp"

SEPARATION = [
    ("sep_mixture", "Original", "Oud and voice together"),
    ("sep_oud", "Extracted oud", "What the method kept as oud"),
    ("sep_voice", "Extracted voice", "Everything it did not explain as oud"),
    ("sep_remix", "Remix", "The extracted oud with the voice turned down 12 dB"),
]
RESTORATION = [
    ("rest_noisy", "Noisy", "The clean take with tape noise added at a known level"),
    ("rest_noise", "Noise", "The noise alone"),
    ("rest_restored", "Restored", "After spectral subtraction"),
    ("rest_clean", "Clean", "The take before any noise was added"),
]


def encode(src: Path, dst: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ar", "44100", "-ac", "1",
         "-b:a", "192k", "-map_metadata", "-1", str(dst)],
        check=True,
    )


def picture(wav: Path, dst: Path) -> None:
    """Spectrogram, 0 to 4 kHz, on the site's background colour."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap

    y, _ = librosa.load(wav, sr=SR, mono=True)
    S = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=2048, hop_length=512)), ref=1.0)
    cmap = LinearSegmentedColormap.from_list("oud", ["#0C0B14", "#4A3A2A", "#C89B5F", "#F6E7CF"])
    fig = plt.figure(figsize=(6.4, 1.6), dpi=100)
    ax = fig.add_axes((0, 0, 1, 1))
    top = int(4000 / (SR / 2) * S.shape[0])
    # one fixed colour scale for every clip, so a quieter clip looks quieter
    ax.imshow(S[:top], origin="lower", aspect="auto", cmap=cmap, vmin=-5, vmax=45)
    ax.axis("off")
    fig.savefig(dst, facecolor="#0C0B14")
    plt.close(fig)


def demucs_baseline(demo: Path) -> dict:
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    mix, _ = sf.read(demo / "sep_mixture.wav")
    oud, _ = sf.read(demo / "sep_true_oud.wav")
    voice, _ = sf.read(demo / "sep_true_voice.wav")
    model = get_model("htdemucs")
    model.eval()
    x = librosa.resample(mix.astype(np.float32), orig_sr=SR, target_sr=model.samplerate)
    with torch.no_grad():
        stems = apply_model(model, torch.tensor(np.stack([x, x]))[None], device="cpu")[0]
    v = stems[model.sources.index("vocals")].mean(0).numpy()
    o = sum(stems[i] for i, n in enumerate(model.sources) if n != "vocals").mean(0).numpy()
    back = lambda z: librosa.resample(z, orig_sr=model.samplerate, target_sr=SR)[: len(mix)]  # noqa: E731
    return {"name": "Demucs (htdemucs, pretrained)", "oudSiSdr": round(si_sdr(back(o), oud), 1),
            "voiceSiSdr": round(si_sdr(back(v), voice), 1)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", type=Path, required=True)
    ap.add_argument("--source", choices=["synthetic", "recording"], required=True)
    ap.add_argument("--performer")
    ap.add_argument("--consent")
    ap.add_argument("--piece")
    ap.add_argument("--demucs", action="store_true")
    a = ap.parse_args()
    if a.source == "recording" and not (a.performer and a.consent and a.piece):
        raise SystemExit("--source recording needs --performer, --consent and --piece")

    m = json.loads((a.demo / "metrics.json").read_text())
    if a.source == "synthetic" and m["source"] != "synthetic test signals":
        raise SystemExit("this run was made from recordings; it cannot be published as synthetic")
    if a.source == "recording" and m["source"] == "synthetic test signals":
        raise SystemExit("this run was made from synthetic signals")

    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = WEB / "public-audio-rights.json"
    manifest = json.loads(manifest_path.read_text())
    for key in [k for k in manifest["files"] if k.startswith("apps/web/public/demos/dsp/")]:
        del manifest["files"][key]
    for old in OUT.glob("*"):
        old.unlink()

    if a.source == "synthetic":
        rights = {"kind": "synthesised", "note": "portfolio_dsp_demo.py --synthetic: plucked-string, sung-vowel and tape-noise signals made in numpy"}
        source = {"kind": "synthetic", "label": "Synthesised test signals, not a recording",
                  "note": "A plucked-string model, a sung-vowel model and cassette-style noise, all made in code. "
                          "They show that the method and the measurement work; they do not show how it sounds on a real oud."}
    else:
        rights = {"kind": "own_recording", "performer": a.performer, "consent": a.consent,
                  "note": f"{a.piece}; recorded for this project, and processed versions of that recording"}
        source = {"kind": "recording", "label": f"{a.piece}, played by {a.performer}",
                  "note": "Recorded for this project. The oud and the voice were recorded separately, so the true parts are known."}

    def block(rows: list[tuple[str, str, str]]) -> list[dict]:
        out = []
        for name, label, what in rows:
            encode(a.demo / f"{name}.wav", OUT / f"{name}.mp3")
            picture(a.demo / f"{name}.wav", OUT / f"{name}.png")
            manifest["files"][f"apps/web/public/demos/dsp/{name}.mp3"] = dict(rights)
            out.append({"id": name, "label": label, "what": what,
                        "file": f"/demos/dsp/{name}.mp3", "image": f"/demos/dsp/{name}.png"})
        return out

    data = {
        "source": source,
        "seconds": m["seconds"],
        "separation": {"method": m["separation"]["method"], "clips": block(SEPARATION),
                       "oud": m["separation"]["oud"], "voice": m["separation"]["voice"],
                       "baseline": demucs_baseline(a.demo) if a.demucs else None},
        "restoration": {"method": m["restoration"]["method"], "clips": block(RESTORATION),
                        "noisySnr": m["restoration"]["noisySnr"], "restoredSnr": m["restoration"]["restoredSnr"]},
    }
    (WEB / "lib" / "dsp-demo.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: data[k] for k in ("source", "seconds")}, indent=1))
    print(f"{len(SEPARATION) + len(RESTORATION)} clips -> {OUT}")


if __name__ == "__main__":
    main()

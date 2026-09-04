"""Stage 3: three zero-shot ACE-Step generations from Somali qaraami lyrics.
Local only; MPS/float32 (bf16 unsupported on Apple GPU). No training."""
import sys, time, json
from pathlib import Path

# ffmpeg 9 breaks torchcodec (supports 4-7); ACE-Step saves via torchaudio.save
# which now delegates to torchcodec. Route saves through soundfile instead.
import numpy as _np, soundfile as _sf, torch as _torch, torchaudio as _ta
def _sf_save(uri, src, sample_rate, *a, **k):
    arr = src.detach().cpu().numpy() if hasattr(src, "detach") else _np.asarray(src)
    if arr.ndim == 2:            # (channels, samples) -> (samples, channels)
        arr = arr.T
    _sf.write(str(uri), arr, int(sample_rate))
_ta.save = _sf_save

REPO = Path.home() / "Projects/somali-music-archive"
OUT = REPO / "data/ace_step_zeroshot"
OUT.mkdir(parents=True, exist_ok=True)

# lyrics from data/lyrics/*.txt (first non-comment lines), else placeholder
lyr_files = sorted((REPO / "data/lyrics").glob("*.txt"))
raw = ""
for f in lyr_files:
    lines = [l for l in f.read_text().splitlines() if l.strip() and not l.strip().startswith("#")]
    if lines:
        raw = "\n".join(lines); break
if not raw:
    raw = "Hobalka qalbigayga, hees baan kuu tirinayaa\nKaban iyo cod baa, jacaylkaaga ii sheegaya"
lyrics = "[verse]\n" + raw + "\n"

STYLE = "Somali qaraami, traditional, oud (kaban), hand drums, male vocal, pentatonic melody, acoustic, warm, mid-tempo"

from acestep.pipeline_ace_step import ACEStepPipeline
t0 = time.time()
pipe = ACEStepPipeline(checkpoint_dir=None, device_id=0, dtype="float32", cpu_offload=False)
print(f"pipeline ready in {time.time()-t0:.0f}s", flush=True)

results = []
for i, (dur, seed) in enumerate([(30, 42), (30, 7), (45, 123)]):
    out = OUT / f"ace_qaraami_{i:02d}_seed{seed}.wav"
    t1 = time.time()
    try:
        pipe(format="wav", audio_duration=dur, prompt=STYLE, lyrics=lyrics,
             infer_step=60, guidance_scale=15.0, manual_seeds=[seed],
             save_path=str(out), batch_size=1)
        ok = out.exists() or any(OUT.glob(f"*seed{seed}*"))
        results.append({"i": i, "seed": seed, "duration": dur, "file": str(out), "ok": ok, "seconds": round(time.time()-t1,1)})
        print(f"sample {i} seed {seed} dur {dur}s -> {'ok' if ok else 'MISSING'} in {time.time()-t1:.0f}s", flush=True)
    except Exception as e:
        results.append({"i": i, "seed": seed, "error": repr(e)[:300]})
        print(f"sample {i} FAILED: {repr(e)[:200]}", flush=True)

(OUT / "generation_log.json").write_text(json.dumps({"style": STYLE, "lyrics": lyrics, "results": results}, indent=2))
print("ACE_GEN_DONE", flush=True)

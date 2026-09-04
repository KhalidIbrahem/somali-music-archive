#!/bin/bash
# Reproduce the oud smoke test from the processed clips/tokens on disk and check the numbers.
# Re-runs the harness for 50 optimizer steps on 20 oud clips (fixed harness), then checks:
#   * 37 functional-dropout attributes zeroed, 192 LoRA sites, 6.29 M trainable
#   * base+zero-init-LoRA validation CE on 64 held-out clips = 4.5132 (deterministic, seed 42)
#   * train loss starts near eval loss (≈4.0, NOT ≈9.5 as under the broken harness)
# Needs: ~/ai/musicgen-env, data/oud_tokens (1,921 .npy) and data/oud_captions.jsonl, musicgen-small in the HF cache.
# Takes ~2 min on an M5 Max (~10 min on an M1). Writes runs/repro_oud_smoke_<date>/.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd)
PY=${PY:-$HOME/ai/musicgen-env/bin/python}
RUN=repro_oud_smoke_$(date +%Y%m%d_%H%M%S)
cd "$REPO/apps/ai-service" || exit 1
if [ ! -f ../../data/oud_captions.jsonl ] || [ ! -d ../../data/oud_tokens ]; then
  echo "oud captions/tokens not present under data/ (they are not distributed). Cannot reproduce."; exit 2
fi
HF_HUB_OFFLINE=1 "$PY" -u -m scripts.phase2_train --smoke --run-id "$RUN" \
  --captions ../../data/oud_captions.jsonl --tokens-dir ../../data/oud_tokens 2>&1 | tee "../../runs/$RUN.log"
"$PY" -m scripts.check_smoke "../../runs/$RUN.log" --captions ../../data/oud_captions.jsonl --tokens-dir ../../data/oud_tokens

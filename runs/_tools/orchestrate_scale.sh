#!/bin/bash
# Overnight Stage-2 orchestrator: tokenize the full 30 s dataset, then train and
# evaluate each MusicGen size SEQUENTIALLY (never two big models at once), with
# the memory cap enforced inside scale_train (--mem-cap-gb aborts cleanly before
# macOS would kill the job). The musicgen-api service (small, ~3 GB) stays up
# throughout; medium/large peak ~11–16 GB, so total wired stays far under 90 GB.
#
# Waits for the full dataset build (data/scale_captions.jsonl) to finish first.
# Each stage writes to runs/<run-id>/ and an eval_<tag>.json; a stage that hits
# the memory cap or errors is logged and the orchestrator moves on.
#
# Usage: nohup bash runs/_tools/orchestrate_scale.sh > runs/_tools/orchestrate_scale.log 2>&1 &
set -u
REPO=$HOME/Projects/somali-music-archive
AI=$REPO/apps/ai-service
PY=$HOME/ai/musicgen-env/bin/python
CAPS=$REPO/data/scale_captions.jsonl
TOK=$REPO/data/scale_tokens
LOG=$REPO/runs/_tools/orchestrate_scale.log
log(){ echo "$(date '+%F %T') $*"; }
cd "$AI" || exit 1
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false

log "START orchestrate_scale (pid $$)"

# 1. wait for the full dataset build to complete (captions file written at the end)
log "waiting for full dataset build ($CAPS)…"
for i in $(seq 1 720); do   # up to 6 h
  if [ -f "$CAPS" ] && ! pgrep -f build_scale_dataset >/dev/null; then break; fi
  sleep 30
done
if [ ! -f "$CAPS" ]; then log "ABORT: dataset never appeared"; exit 1; fi
NCLIPS=$(wc -l < "$CAPS" | tr -d ' ')
log "dataset ready: $NCLIPS clips"

# 2. tokenize the full dataset (30 s → (4,1500))
log "tokenizing…"
"$PY" -m scripts.scale_tokens --captions "$CAPS" --tokens-dir "$TOK" --seconds 30 2>&1 | tail -3
log "tokenized: $(ls "$TOK" 2>/dev/null | wc -l | tr -d ' ') npy"

run_stage(){  # model, run_id, tag, grad_accum
  local model="$1" run_id="$2" tag="$3" ga="$4"
  log "=== TRAIN $tag ($model, grad-accum $ga) ==="
  "$PY" -m scripts.scale_train --model "$model" --run-id "$run_id" --lr 5e-5 \
     --total-steps 3000 --ckpt-every 250 --batch-size 1 --grad-accum "$ga" \
     --rank 32 --alpha 64 --captions "$CAPS" --tokens-dir "$TOK" \
     --sample-seconds 15 --mem-cap-gb 85 2>&1 | grep -E "step |ckpt|val |MEM_CAP|DONE|Error"
  local rc=${PIPESTATUS[0]}
  log "$tag training rc=$rc"
  if ls "$REPO/runs/$run_id"/ckpt_step_* >/dev/null 2>&1; then
    log "=== EVAL $tag ==="
    "$PY" -m scripts.scale_eval --run "runs/$run_id" --model "$model" --tag "$tag" \
       --captions "$CAPS" --tokens-dir "$TOK" --n-ab 16 --ab-seconds 15 2>&1 | grep -E "per_song|improvement|ab |SCALE_EVAL|Error" | tail -20
    log "$tag eval done"
  else
    log "$tag produced no checkpoints; skipping eval"
  fi
}

# 3. medium (primary), then large. Melody handled separately (needs chroma cond).
run_stage facebook/musicgen-medium qaraami_medium_r32 medium 4
run_stage facebook/musicgen-large  qaraami_large_r32  large  4

touch "$REPO/runs/_tools/SCALE_ALL_DONE"
log "ALL DONE"

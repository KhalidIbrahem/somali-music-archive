#!/bin/bash
# Sequential fixed-harness Harvard reruns on the M5 Max:
#   tmux harvard_denoise_prep : DeepFilterNet3 clip denoising (CPU), concurrent with the raw run
#   tmux harvard_raw          : LoRA fine-tune on data/tokens
#   tmux harvard_denoised     : EnCodec tokens for the denoised clips, then LoRA fine-tune
#   then test-CE eval for both. Never two fine-tunes at once.
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; TOOLS=$REPO/runs/_tools
PY=$HOME/ai/musicgen-env/bin/python
LOG=$TOOLS/orchestrate.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
wait_unpaused(){ while [ -f "$TOOLS/PAUSED" ]; do sleep 15; done; }
wait_session(){ while tmux has-session -t "$1" 2>/dev/null; do sleep 15; done; }
abort(){ log "ABORT: $*"; touch "$TOOLS/ALL_DONE"; exit 1; }
rm -f "$TOOLS/ALL_DONE"
log "START orchestrate (pid $$)"

if [ ! -f "$REPO/data/clips_denoised/.DONE" ]; then
  tmux new-session -d -s harvard_denoise_prep -c "$AI" "bash $TOOLS/stage_denoise_prep.sh"
  log "launched tmux harvard_denoise_prep"
fi

wait_unpaused
tmux new-session -d -s harvard_raw -c "$AI" "bash $TOOLS/stage_train.sh harvard_raw"
log "launched tmux harvard_raw"
wait_session harvard_raw
rc=$(grep -o 'RUN_EXIT=[0-9a-z_]*' "$REPO/runs/harvard_raw/train.log" 2>/dev/null | tail -1)
log "harvard_raw finished: ${rc:-no RUN_EXIT line}"
[ "$rc" = "RUN_EXIT=0" ] || abort "harvard_raw failed"

wait_session harvard_denoise_prep
[ -f "$REPO/data/clips_denoised/.DONE" ] || abort "denoise prep did not complete (see data/clips_denoised/denoise.log)"
log "denoise prep complete"

wait_unpaused
tmux new-session -d -s harvard_denoised -c "$AI" "bash $TOOLS/stage_train.sh harvard_denoised"
log "launched tmux harvard_denoised"
wait_session harvard_denoised
rc=$(grep -o 'RUN_EXIT=[0-9a-z_]*' "$REPO/runs/harvard_denoised/train.log" 2>/dev/null | tail -1)
log "harvard_denoised finished: ${rc:-no RUN_EXIT line}"
[ "$rc" = "RUN_EXIT=0" ] || abort "harvard_denoised failed"

wait_unpaused
log "eval: test CE per checkpoint, both runs"
if (cd "$AI" && "$PY" -u "$TOOLS/eval_test_ce.py") >> "$TOOLS/eval.log" 2>&1; then log "eval done"; else log "eval FAILED (see runs/_tools/eval.log)"; fi
touch "$TOOLS/ALL_DONE"; log "ALL_DONE"

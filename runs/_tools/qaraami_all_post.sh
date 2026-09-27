#!/bin/bash
# Post-training step for the qaraami_all run: waits for tmux session qaraami_all to end,
# requires SCALE_TRAIN_DONE in train.log, evaluates the best-val checkpoint against
# musicgen-medium (per-song test CE + bootstrap CI, 16-pair A/B at 30 s into
# data/ab_qaraami_all/ on the shared data/ab_captions.json list, seeds 42+i), then
# writes runs/qaraami_all/RESULT.md. Runs inside tmux session qaraami_all_post.
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; PY=$HOME/ai/musicgen-env/bin/python
RUN=qaraami_all; RUN_DIR=$REPO/runs/$RUN; LOG=$RUN_DIR/post.log
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
log "waiting for tmux session $RUN to end"
while tmux has-session -t "=$RUN" 2>/dev/null; do sleep 120; done
if ! grep -q SCALE_TRAIN_DONE "$RUN_DIR/train.log"; then
  log "POST_ABORT: train.log has no SCALE_TRAIN_DONE (last line: $(tail -1 "$RUN_DIR/train.log"))"; exit 1
fi
log "training done; launching scale_eval"
cd "$AI" || exit 1
caffeinate -s -i "$PY" -u -m scripts.scale_eval --run "$RUN_DIR" --model facebook/musicgen-medium --tag $RUN \
  --captions "$REPO/data/sets/run_${RUN}_captions.jsonl" --tokens-dir "$REPO/data/sets/ahmed_oud/tokens" \
  --rank 32 --alpha 64 --n-ab 16 --ab-seconds 30 --ab-captions data/ab_captions.json \
  >> "$RUN_DIR/eval.log" 2>&1; rc=$?
log "scale_eval rc=$rc"
"$PY" "$REPO/runs/_tools/qaraami_all_result.py" 2>&1 | tee -a "$LOG"
[ $rc -eq 0 ] && touch "$RUN_DIR/POST_DONE"
log "POST_END rc=$rc"

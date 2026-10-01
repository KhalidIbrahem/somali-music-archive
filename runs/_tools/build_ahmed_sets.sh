#!/bin/bash
# Stage 2: cut the Ahmed sets, tokenise the trainable ones, precompute chroma for the
# melody run, merge the run captions. Resumable; rerun after any interruption.
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; PY=$HOME/ai/musicgen-env/bin/python
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
LOG=$REPO/data/sets/build.log; mkdir -p "$REPO/data/sets"
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
cd "$AI" || exit 1
for st in ahmed_oud ahmed_mix ahmed_vocal; do
  log "=== build $st"; "$PY" -u -m scripts.build_sets --set "$st" 2>&1 | grep -vE "^\s+[0-9]+/[0-9]+ " | tail -40 | tee -a "$LOG"
  log "$st rc=${PIPESTATUS[0]}"
done
for st in ahmed_oud ahmed_mix; do
  log "=== tokens $st"; "$PY" -u -m scripts.scale_tokens --captions "$REPO/data/sets/$st/captions.jsonl" --tokens-dir "$REPO/data/sets/$st/tokens" --seconds 30 2>&1 | tail -3 | tee -a "$LOG"
  log "$st tokens: $(ls $REPO/data/sets/$st/tokens | wc -l | tr -d ' ') npy"
done
log "=== chroma ahmed_oud"; "$PY" -u -m scripts.scale_chroma --captions "$REPO/data/sets/ahmed_oud/captions.jsonl" --chroma-dir "$REPO/data/sets/ahmed_oud/chroma" --seconds 30 --write-chroma-dir 2>&1 | tail -4 | tee -a "$LOG"
log "=== merges"
"$PY" -m scripts.build_sets --merge run_ahmed_only --sets ahmed_oud --out "$REPO/data/sets/run_ahmed_only_captions.jsonl" 2>&1 | tail -12 | tee -a "$LOG"
"$PY" -m scripts.build_sets --merge run_ahmed_only_large --sets ahmed_oud ahmed_mix --out "$REPO/data/sets/run_ahmed_only_large_captions.jsonl" 2>&1 | tail -12 | tee -a "$LOG"
log "BUILD_AHMED_SETS_DONE"

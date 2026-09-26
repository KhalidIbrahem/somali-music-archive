#!/bin/bash
# harvard_full at 30 s and 10 s (research-only), tokens; resumable (rerun after the retry fetch pass).
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; PY=$HOME/ai/musicgen-env/bin/python
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
LOG=$REPO/data/sets/build_harvard.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
cd "$AI" || exit 1
build(){ log "=== build $1 @ $2 s -> $3 (scorer budget $4)"; "$PY" -u -m scripts.build_sets --set "$1" --seconds "$2" --out-root "$3" --scorer-clips-per-song "$4" 2>&1 | grep -vE "^\s+[0-9]+/[0-9]+ " | tail -25 | tee -a "$LOG"; log "$1 @ $2 s rc=${PIPESTATUS[0]}"; }
tokens(){ log "=== tokens $1"; "$PY" -u -m scripts.scale_tokens --captions "$1" --tokens-dir "$2" --seconds "$3" 2>&1 | tail -2 | tee -a "$LOG"; }
build harvard_full 30 "$REPO/data/sets" 3
build harvard_full 10 "$REPO/data/sets_10s" 3
tokens "$REPO/data/sets/harvard_full/captions.jsonl" "$REPO/data/sets/harvard_full/tokens" 30
tokens "$REPO/data/sets_10s/harvard_full/captions.jsonl" "$REPO/data/sets_10s/harvard_full/tokens" 10
log "BUILD_HARVARD_SETS_DONE"

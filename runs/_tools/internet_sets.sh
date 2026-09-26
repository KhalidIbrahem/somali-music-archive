#!/bin/bash
# Re-classify the internet inventory with Ahmed's seeds as reference, stamp the rights review, build the internet sets.
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; PY=$HOME/ai/musicgen-env/bin/python
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
LOG=$REPO/data/internet/run.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
cd "$AI" || exit 1
log "=== classify internet inventory with --seed-from ahmed_classified"
"$PY" -u -m scripts.ahmed_classify --inventory "$REPO/data/inventory/internet_files.jsonl" --out "$REPO/data/inventory/internet_classified.jsonl" --report "$REPO/data/inventory/internet_classifier.json" --projects "$REPO/data/inventory/internet_projects.json" --embeddings "$REPO/data/embeddings_internet" --chunks 2 --seed-from "$REPO/data/inventory/ahmed_classified.jsonl" 2>&1 | grep -vE "^\s+[0-9]+/" | tail -32 | tee -a "$LOG"
log "classify rc=${PIPESTATUS[0]}"
"$PY" -m scripts.internet_rights_review --apply 2>&1 | tail -3 | tee -a "$LOG"
build(){ log "=== build $1 @ $2 s -> $3 (scorer budget $4)"; "$PY" -u -m scripts.build_sets --set "$1" --classified "$REPO/data/inventory/internet_classified.jsonl" --seconds "$2" --out-root "$3" --scorer-clips-per-song "$4" 2>&1 | grep -vE "^\s+[0-9]+/[0-9]+ " | tail -20 | tee -a "$LOG"; log "$1 rc=${PIPESTATUS[0]}"; }
tokens(){ [ -f "$1" ] || return 0; log "=== tokens $1"; "$PY" -u -m scripts.scale_tokens --captions "$1" --tokens-dir "$2" --seconds "$3" 2>&1 | tail -2 | tee -a "$LOG"; }
build internet_oud 30 "$REPO/data/sets" 0
build internet_mix 30 "$REPO/data/sets" 3
build internet_oud 10 "$REPO/data/sets_10s" 6
build internet_mix 10 "$REPO/data/sets_10s" 3
tokens "$REPO/data/sets/internet_oud/captions.jsonl" "$REPO/data/sets/internet_oud/tokens" 30
tokens "$REPO/data/sets/internet_mix/captions.jsonl" "$REPO/data/sets/internet_mix/tokens" 30
tokens "$REPO/data/sets_10s/internet_oud/captions.jsonl" "$REPO/data/sets_10s/internet_oud/tokens" 10
tokens "$REPO/data/sets_10s/internet_mix/captions.jsonl" "$REPO/data/sets_10s/internet_mix/tokens" 10
log "INTERNET_SETS_DONE"

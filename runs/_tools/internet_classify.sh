#!/bin/bash
# Classify the (rights-reviewed) internet inventory, then stamp the review onto the classified rows.
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; PY=$HOME/ai/musicgen-env/bin/python
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
LOG=$REPO/data/internet/run.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
cd "$AI" || exit 1
log "=== classify internet inventory (reviewed)"
"$PY" -u -m scripts.ahmed_classify --inventory "$REPO/data/inventory/internet_files.jsonl" --out "$REPO/data/inventory/internet_classified.jsonl" --report "$REPO/data/inventory/internet_classifier.json" --projects "$REPO/data/inventory/internet_projects.json" --embeddings "$REPO/data/embeddings_internet" --chunks 2 2>&1 | grep -vE "^\s+[0-9]+/" | tail -30 | tee -a "$LOG"
log "classify rc=${PIPESTATUS[0]}"
"$PY" -m scripts.internet_rights_review --apply 2>&1 | tail -4 | tee -a "$LOG"
log "INTERNET_CLASSIFY_DONE"

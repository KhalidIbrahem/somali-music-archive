#!/bin/bash
# Full rights-gated internet acquisition (IA + YouTube CC), then inventory, classification and report.
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; PY=$HOME/ai/musicgen-env/bin/python
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
LOG=$REPO/data/internet/run.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
cd "$AI" || exit 1
log "=== acquire (ia yt), max 200 items/source, 40 h cap"
"$PY" -u -m scripts.internet_acquire --sources ia yt --inventory --report 2>&1 | tail -40 | tee -a "$LOG"
log "acquire rc=${PIPESTATUS[0]}"
if [ -f "$REPO/data/inventory/internet_files.jsonl" ]; then
  log "=== classify internet inventory"
  "$PY" -u -m scripts.ahmed_classify --inventory "$REPO/data/inventory/internet_files.jsonl" --out "$REPO/data/inventory/internet_classified.jsonl" --report "$REPO/data/inventory/internet_classifier.json" --projects "$REPO/data/inventory/internet_projects.json" --embeddings "$REPO/data/embeddings_internet" --chunks 2 2>&1 | grep -vE "^\s+[0-9]+/" | tail -30 | tee -a "$LOG"
  log "classify rc=${PIPESTATUS[0]}"
fi
log "INTERNET_RUN_DONE"

#!/bin/bash
# Waits for the Ahmed corpus to be separated and the v2 set chain to finish, then builds the
# sep_* sets (30 s + 10 s), melody MIDI for sep_oud, tokens, and launches orchestrate_v2.
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; PY=$HOME/ai/musicgen-env/bin/python
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
LOG=$REPO/data/sets/after_separation.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
need=${AHMED_MIXES:-441}
log "waiting for $need Ahmed stems.json under data/separated/ahmed and BUILD_SETS_V2_DONE"
while true; do
  n=$(ls "$REPO"/data/separated/ahmed/*/stems.json 2>/dev/null | wc -l | tr -d ' ')
  done_sets=$(grep -c BUILD_SETS_V2_DONE "$REPO/data/sets/build_v2.log" 2>/dev/null)
  if [ "$n" -ge "$need" ] && [ "${done_sets:-0}" -ge 1 ]; then break; fi
  sleep 300
done
log "ahmed separated: $n files; set chain done"
cd "$AI" || exit 1
"$PY" -m scripts.separate_stems --dry-run 2>&1 | tail -3 | tee -a "$LOG"
build(){ log "=== build $1 @ $2 s -> $3 (scorer budget $4)"; "$PY" -u -m scripts.build_sets --set "$1" --seconds "$2" --out-root "$3" --scorer-clips-per-song "$4" 2>&1 | grep -vE "^\s+[0-9]+/[0-9]+ " | tail -25 | tee -a "$LOG"; log "$1 rc=${PIPESTATUS[0]}"; }
tokens(){ log "=== tokens $1"; "$PY" -u -m scripts.scale_tokens --captions "$1" --tokens-dir "$2" --seconds "$3" 2>&1 | tail -2 | tee -a "$LOG"; }
build sep_oud 30 "$REPO/data/sets" 0
build sep_vocal 30 "$REPO/data/sets" 3
build sep_oud 10 "$REPO/data/sets_10s" 6
build sep_vocal 10 "$REPO/data/sets_10s" 3
log "=== melody midi sep_oud"; "$PY" -u -m scripts.melody_midi --captions "$REPO/data/sets/sep_oud/captions.jsonl" --device mps --write-midi-captions 2>&1 | grep -vE "^\s+[0-9]+/[0-9]+ " | tail -10 | tee -a "$LOG"
tokens "$REPO/data/sets/sep_oud/captions.jsonl" "$REPO/data/sets/sep_oud/tokens" 30
tokens "$REPO/data/sets/sep_vocal/captions.jsonl" "$REPO/data/sets/sep_vocal/tokens" 30
tokens "$REPO/data/sets_10s/sep_oud/captions.jsonl" "$REPO/data/sets_10s/sep_oud/tokens" 10
tokens "$REPO/data/sets_10s/sep_vocal/captions.jsonl" "$REPO/data/sets_10s/sep_vocal/tokens" 10
log "=== corpus report"; "$PY" -m scripts.corpus_report --quiet 2>&1 | tail -2 | tee -a "$LOG"
log "=== launching orchestrate_v2"
tmux new-session -d -s orchestrate_v2 "bash $REPO/runs/_tools/orchestrate_v2.sh > /dev/null 2>&1; sleep 30"
log "AFTER_SEPARATION_DONE"

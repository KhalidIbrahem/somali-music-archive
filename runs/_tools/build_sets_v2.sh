#!/bin/bash
# Phase 1 set chain (qaraami-v2): caption v2 for the Ahmed sets at 30 s, the 10 s variants,
# melody MIDI + MIDI chroma for the oud sets, tokens for everything new, corpus report.
# Resumable: every step skips what exists. Runs beside the Demucs shards; sep_* sets are
# built later by build_sep_sets.sh once data/separated has the Ahmed corpus.
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; PY=$HOME/ai/musicgen-env/bin/python
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
LOG=$REPO/data/sets/build_v2.log; mkdir -p "$REPO/data/sets" "$REPO/data/sets_10s"
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
cd "$AI" || exit 1
build(){ # set seconds out_root scorer_budget
  log "=== build $1 @ $2 s -> $3 (scorer budget $4)"
  "$PY" -u -m scripts.build_sets --set "$1" --seconds "$2" --out-root "$3" --scorer-clips-per-song "$4" 2>&1 | grep -vE "^\s+[0-9]+/[0-9]+ " | tail -25 | tee -a "$LOG"
  log "$1 @ $2 s rc=${PIPESTATUS[0]}"
}
tokens(){ # captions tokens_dir seconds
  log "=== tokens $1"; "$PY" -u -m scripts.scale_tokens --captions "$1" --tokens-dir "$2" --seconds "$3" 2>&1 | tail -2 | tee -a "$LOG"
}
build ahmed_oud 30 "$REPO/data/sets" 0
build ahmed_vocal 30 "$REPO/data/sets" 3
build ahmed_mix 30 "$REPO/data/sets" 3
build ahmed_oud 10 "$REPO/data/sets_10s" 6
build ahmed_vocal 10 "$REPO/data/sets_10s" 3
build ahmed_mix 10 "$REPO/data/sets_10s" 3
log "=== melody midi ahmed_oud (30 s)"
"$PY" -u -m scripts.melody_midi --captions "$REPO/data/sets/ahmed_oud/captions.jsonl" --device mps --write-midi-captions 2>&1 | grep -vE "^\s+[0-9]+/[0-9]+ " | tail -12 | tee -a "$LOG"
log "melody rc=${PIPESTATUS[0]}"
tokens "$REPO/data/sets_10s/ahmed_oud/captions.jsonl" "$REPO/data/sets_10s/ahmed_oud/tokens" 10
tokens "$REPO/data/sets_10s/ahmed_vocal/captions.jsonl" "$REPO/data/sets_10s/ahmed_vocal/tokens" 10
tokens "$REPO/data/sets_10s/ahmed_mix/captions.jsonl" "$REPO/data/sets_10s/ahmed_mix/tokens" 10
tokens "$REPO/data/sets/ahmed_vocal/captions.jsonl" "$REPO/data/sets/ahmed_vocal/tokens" 30
log "=== corpus report"; "$PY" -m scripts.corpus_report --quiet 2>&1 | tail -3 | tee -a "$LOG"
log "BUILD_SETS_V2_DONE"

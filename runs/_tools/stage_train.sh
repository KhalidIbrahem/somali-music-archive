#!/bin/bash
# One training stage inside its tmux session. harvard_denoised first tokenizes the
# denoised clips with the project's own encoder script (facebook/encodec_32khz, identical
# settings to data/tokens), then trains. Log: runs/<run>/train.log
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; TOOLS=$REPO/runs/_tools
PY=$HOME/ai/musicgen-env/bin/python
RUN=$1; OUT=$REPO/runs/$RUN; mkdir -p "$OUT"; LOG=$OUT/train.log
cd "$AI" || exit 1
EXTRA=""
if [ "$RUN" = "harvard_denoised" ]; then
  "$PY" -u -m scripts.phase1_tokens --captions "$REPO/data/captions_denoised.jsonl" \
        --tokens-dir "$REPO/data/tokens_denoised" 2>&1 | tee -a "$OUT/tokens.log"
  if [ "${PIPESTATUS[0]}" != "0" ]; then echo "RUN_EXIT=tokens_failed" | tee -a "$LOG"; exit 1; fi
  EXTRA="--captions $REPO/data/captions_denoised.jsonl --tokens-dir $REPO/data/tokens_denoised"
fi
"$PY" -u "$TOOLS/train_run.py" --run-id "$RUN" --lr 1e-4 --total-steps 1500 $EXTRA 2>&1 | tee -a "$LOG"
echo "RUN_EXIT=${PIPESTATUS[0]}" | tee -a "$LOG"

#!/bin/bash
# Fresh 3000-step fixed-harness raw Harvard run inside tmux harvard_raw_3000.
# HF_HUB_OFFLINE=1 so adapter saves never call out; caffeinate -i (bound to the trainer's PID)
# blocks idle sleep for the duration. Does not prevent clamshell sleep on battery.
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; TOOLS=$REPO/runs/_tools
PY=$HOME/ai/musicgen-env/bin/python
RUN=harvard_raw_3000; OUT=$REPO/runs/$RUN; mkdir -p "$OUT"; LOG=$OUT/train.log
cd "$AI" || exit 1
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
"$PY" -u "$TOOLS/train_run.py" --run-id "$RUN" --lr 1e-4 --total-steps 3000 >> "$LOG" 2>&1 &
PID=$!
caffeinate -i -w $PID &
wait $PID; rc=$?
echo "RUN_EXIT=$rc" >> "$LOG"

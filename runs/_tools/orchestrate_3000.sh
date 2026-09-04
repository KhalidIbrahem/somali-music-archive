#!/bin/bash
set -u
REPO=$HOME/Projects/somali-music-archive; AI=$REPO/apps/ai-service; TOOLS=$REPO/runs/_tools
PY=$HOME/ai/musicgen-env/bin/python
LOG=$TOOLS/orchestrate_3000.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
wait_unpaused(){ while [ -f "$TOOLS/PAUSED" ]; do sleep 15; done; }
wait_session(){ while tmux has-session -t "$1" 2>/dev/null; do sleep 15; done; }
rm -f "$TOOLS/ALL_DONE"
log "START orchestrate_3000 (pid $$) power: $(pmset -g batt | head -1)"
wait_unpaused
tmux new-session -d -s harvard_raw_3000 -c "$AI" "bash $TOOLS/stage_train_3000.sh"
log "launched tmux harvard_raw_3000"
wait_session harvard_raw_3000
rc=$(grep -o 'RUN_EXIT=[0-9a-z_]*' "$REPO/runs/harvard_raw_3000/train.log" 2>/dev/null | tail -1)
log "harvard_raw_3000 finished: ${rc:-no RUN_EXIT line}"
if [ "$rc" = "RUN_EXIT=0" ]; then
  wait_unpaused
  log "eval: test CE per checkpoint"
  if (cd "$AI" && HF_HUB_OFFLINE=1 "$PY" -u "$TOOLS/eval_run_ce.py" --run harvard_raw_3000) >> "$TOOLS/eval_3000.log" 2>&1; then log "eval done"; else log "eval FAILED (see runs/_tools/eval_3000.log)"; fi
else
  log "ABORT: training failed, skipping eval"
fi
touch "$TOOLS/ALL_DONE"; log "ALL_DONE"

#!/bin/bash
# Memory-pressure guard for the Harvard reruns. macOS kern.memorystatus_vm_pressure_level:
# 1 = normal, 2 = warn (yellow), 4 = critical (red). On >= 2, SIGSTOP every training /
# preprocessing process and report; jobs stay paused until resumed by hand:
#   kill -CONT $(pgrep -f 'train_run.py|denoise_clips.py|phase1_tokens|eval_test_ce.py'); rm runs/_tools/PAUSED
PAT='train_run.py|denoise_clips.py|phase1_tokens|eval_test_ce.py|eval_run_ce.py|harvard_ab_gen.py|phase3_pcs_run'
TOOLS=$HOME/Projects/somali-music-archive/runs/_tools
FLAG=$TOOLS/PAUSED
state=0   # 0 running, 1 paused (pressure high), 2 paused (pressure back to normal, awaiting resume)
while true; do
  lvl=$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null || echo 1)
  if [ ! -f "$FLAG" ] && [ $state -ne 0 ]; then state=0; echo "resumed by operator (PAUSED flag removed), level=$lvl"; fi
  if [ "$lvl" -ge 2 ] && [ $state -eq 0 ]; then
    pids=$(pgrep -f "$PAT" | tr '\n' ' ')
    [ -n "$pids" ] && kill -STOP $pids 2>/dev/null
    state=1; date '+%F %T' > "$FLAG"
    echo "PAUSED: memory pressure level=$lvl (2=yellow,4=red) free=$(memory_pressure 2>/dev/null | awk '/free percentage/{print $NF}') stopped pids=[$pids]"
  elif [ $state -eq 1 ] && [ "$lvl" -lt 2 ]; then
    state=2; echo "pressure back to normal (level=$lvl); jobs remain PAUSED until resumed"
  elif [ $state -eq 2 ] && [ "$lvl" -ge 2 ]; then
    state=1; echo "pressure high again level=$lvl (jobs still paused)"
  fi
  if [ -f "$TOOLS/ALL_DONE" ]; then echo "guard exiting: ALL_DONE"; exit 0; fi
  sleep 5
done

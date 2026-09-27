#!/bin/bash
# Memory-pressure guard for the qaraami_all run (kern.memorystatus_vm_pressure_level: 1 normal, 2 yellow, 4 red).
# Logs the level and free % every 60 s; on >= 2 it SIGSTOPs scale_train (the run pauses, nothing is lost),
# writes runs/qaraami_all/PAUSED_ON_PRESSURE and keeps it paused until the operator removes the flag
# and sends kill -CONT. Exits when runs/qaraami_all/POST_DONE or train.log's SCALE_TRAIN_DONE exists.
RUN=$HOME/Projects/somali-music-archive/runs/qaraami_all; FLAG=$RUN/PAUSED_ON_PRESSURE; LOG=$RUN/pressure.log
paused=0
while true; do
  lvl=$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null || echo 1)
  free=$(memory_pressure 2>/dev/null | awk '/free percentage/{print $NF}')
  echo "$(date '+%F %T') level=$lvl free=$free" >> "$LOG"
  if [ "$lvl" -ge 2 ] && [ $paused -eq 0 ]; then
    pids=$(pgrep -f 'scripts.scale_train --model facebook/musicgen-medium --run-id qaraami_all ' | tr '\n' ' ')
    [ -n "$pids" ] && kill -STOP $pids 2>/dev/null
    paused=1; date '+%F %T' > "$FLAG"
    echo "$(date '+%F %T') PAUSED_ON_PRESSURE level=$lvl pids=[$pids]; resume: rm $FLAG; kill -CONT $pids" >> "$LOG"
  elif [ $paused -eq 1 ] && [ ! -f "$FLAG" ]; then paused=0; echo "$(date '+%F %T') resumed by operator" >> "$LOG"; fi
  [ -f "$RUN/POST_DONE" ] && { echo "$(date '+%F %T') guard exit: POST_DONE" >> "$LOG"; exit 0; }
  sleep 60
done

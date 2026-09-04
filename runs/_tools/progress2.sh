#!/bin/bash
# Like progress.sh but takes the log files to watch as arguments. bash 3.2 compatible.
TOOLS=$HOME/Projects/somali-music-archive/runs/_tools
PAT='\[ckpt|\[val|step 0 \(|Traceback|Error|error|Killed|RUN_EXIT|ABORT|launched|finished|TRAIN_RUN_DONE|EVAL_DONE|AB_GEN_DONE|test CE|ALL_DONE|sample_wav|harness argv|done in|pcs_mean|voiced_fraction_mean|scoring'
FILES=("$@"); POS=(); i=0; while [ $i -lt ${#FILES[@]} ]; do POS[$i]=0; i=$((i+1)); done
while true; do
  i=0
  while [ $i -lt ${#FILES[@]} ]; do
    f=${FILES[$i]}
    if [ -f "$f" ]; then
      n=$(wc -l < "$f" | tr -d ' '); p=${POS[$i]}
      if [ "$n" -gt "$p" ]; then
        tag=$(basename "$(dirname "$f")")/$(basename "$f")
        sed -n "$((p+1)),${n}p" "$f" | grep -E "$PAT" | grep -vE "deprecated|use_cache|huggingface.co" | sed "s|^|$tag: |"
        POS[$i]=$n
      fi
    fi
    i=$((i+1))
  done
  if [ -f "$TOOLS/ALL_DONE" ]; then echo "ALL_DONE (orchestrator finished)"; exit 0; fi
  sleep 20
done

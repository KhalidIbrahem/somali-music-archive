#!/bin/bash
# Emits only the lines worth acting on from every stage log (new lines since last poll).
# bash 3.2 compatible (no associative arrays).
REPO=$HOME/Projects/somali-music-archive; TOOLS=$REPO/runs/_tools
PAT='\[ckpt|\[val|step 0 \(|Traceback|Error|error|Killed|RUN_EXIT|DENOISE_EXIT|DENOISE_DONE|DENOISE_INCOMPLETE|ABORT|launched|finished|complete|denoised [0-9]+/|to encode|clips_per_s|TRAIN_RUN_DONE|EVAL_DONE|test CE|ALL_DONE|sample_wav|harness argv'
FILES=("$TOOLS/orchestrate.log" "$REPO/runs/harvard_raw/train.log" "$REPO/runs/harvard_denoised/tokens.log" "$REPO/runs/harvard_denoised/train.log" "$REPO/data/clips_denoised/denoise.log" "$TOOLS/eval.log")
POS=(0 0 0 0 0 0)
while true; do
  i=0
  while [ $i -lt ${#FILES[@]} ]; do
    f=${FILES[$i]}
    if [ -f "$f" ]; then
      n=$(wc -l < "$f" | tr -d ' '); p=${POS[$i]}
      if [ "$n" -gt "$p" ]; then
        tag=$(basename "$(dirname "$f")")/$(basename "$f")
        sed -n "$((p+1)),${n}p" "$f" | grep -E "$PAT" | grep -vE "deprecated|use_cache|not a git repository" | sed "s|^|$tag: |"
        POS[$i]=$n
      fi
    fi
    i=$((i+1))
  done
  if [ -f "$TOOLS/ALL_DONE" ]; then echo "ALL_DONE (orchestrator finished)"; exit 0; fi
  sleep 20
done

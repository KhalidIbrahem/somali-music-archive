#!/bin/bash
# Stage 3-4 orchestrator: the Ahmed Ilkacase corpus adapters, one run at a time,
# each in its own tmux session, each first probed for memory. bash 3.2 (macOS).
#
# Runs, in order, with the brief's hyper-parameters (batch 1, grad-accum 4,
# cosine with 100 warm-up, ckpt every 250, fixed-dropout harness):
#   ahmed_only        musicgen-medium  r32 α64   lr 5e-5  3000 steps  run_ahmed_only_captions.jsonl (ahmed_oud + ahmed_collection oud rows)
#   ahmed_only_large  musicgen-large   r64 α128  lr 3e-5  3000 steps  run_ahmed_only_large_captions.jsonl (ahmed_oud + ahmed_mix)
#   combined_large    musicgen-large   r64 α128  lr 3e-5  3000 steps  run_combined_large_captions.jsonl (+ harvard_full); eval head-to-head vs ahmed_only_large
#   ahmed_melody      musicgen-melody  r32 α64   lr 5e-5  3000 steps  data/sets/ahmed_oud/captions.jsonl with --chroma-dir
# (COMBINED_ALPHA=64 in the environment switches combined_large to α64.)
#
# Per run: skip if runs/<run>/eval_<run>.json exists AND is complete (it carries
# "headtohead" when the recipe asks for one) → batch-size probe (scale_train
# --smoke 20, grad-accum 4; abort the run if peak_driver_gb > MEM_CAP_GB) →
# train in tmux session <run> under caffeinate, --mem-cap-gb 85, log
# runs/<run>/train.log → wait for the session → eval in tmux <run>_eval
# (scale_eval --n-ab 16 --ab-seconds 30 --ab-captions data/ab_captions_ahmed.json
# --ab-rights ahmed_ilkacase_consented) → next run. A run whose train.log shows
# a kill (checkpoints but no SCALE_TRAIN_DONE) resumes from its last checkpoint.
# The shared A/B caption list is seeded once from data/sets/ahmed_oud/captions.jsonl
# (consented test rows only) before the first eval; a head-to-head eval is only
# launched when the other run has a saved adapter. Finally scripts.ahmed_report.
#
# Launch (Khalid only, AC power, corpus sets built and tokenised):
#   nohup bash runs/_tools/orchestrate_ahmed.sh > /dev/null 2>&1 &
# Everything logs to runs/_tools/orchestrate_ahmed.log.
set -u
REPO=$HOME/Projects/somali-music-archive
AI=$REPO/apps/ai-service
TOOLS=$REPO/runs/_tools
PY=$HOME/ai/musicgen-env/bin/python
LOG=$TOOLS/orchestrate_ahmed.log
MEM_CAP_GB=${MEM_CAP_GB:-85}
PROBE_STEPS=${PROBE_STEPS:-20}
GRAD_ACCUM=4
CKPT_EVERY=250
TOTAL_STEPS=3000
FALLBACK_TOKENS=$REPO/data/sets/ahmed_oud/tokens     # rows carry their own tokens_dir; this is the CLI fallback
AB_CAPTIONS=data/ab_captions_ahmed.json               # repo-relative, shared by every Ahmed eval
AB_RIGHTS=ahmed_ilkacase_consented                    # only rows with these rights may seed it
AB_SEED_CAPTIONS=$REPO/data/sets/ahmed_oud/captions.jsonl
AB_N=16
RUNS="ahmed_only ahmed_only_large combined_large ahmed_melody"
ENV="env HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false"
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false

log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
# "=name" makes tmux match the session name exactly (a bare "ahmed_only" would also match "ahmed_only_large")
session_live(){ tmux has-session -t "=$1" 2>/dev/null; }
wait_session(){ while session_live "$1"; do sleep 30; done; }

recipe(){  # sets MODEL RANK ALPHA LR CAPTIONS EXTRA_TRAIN EXTRA_EVAL H2H_RUN for run $1
  MODEL=""; RANK=""; ALPHA=""; LR=""; CAPTIONS=""; EXTRA_TRAIN=""; EXTRA_EVAL=""; H2H_RUN=""
  case "$1" in
    ahmed_only)
      MODEL=facebook/musicgen-medium; RANK=32; ALPHA=64; LR=5e-5
      CAPTIONS=$REPO/data/sets/run_ahmed_only_captions.jsonl ;;
    ahmed_only_large)
      MODEL=facebook/musicgen-large; RANK=64; ALPHA=128; LR=3e-5
      CAPTIONS=$REPO/data/sets/run_ahmed_only_large_captions.jsonl ;;
    combined_large)
      MODEL=facebook/musicgen-large; RANK=64; ALPHA=${COMBINED_ALPHA:-128}; LR=3e-5
      CAPTIONS=$REPO/data/sets/run_combined_large_captions.jsonl
      H2H_RUN=runs/ahmed_only_large
      EXTRA_EVAL="--headtohead-run $H2H_RUN" ;;
    ahmed_melody)
      MODEL=facebook/musicgen-melody; RANK=32; ALPHA=64; LR=5e-5
      CAPTIONS=$REPO/data/sets/ahmed_oud/captions.jsonl
      EXTRA_TRAIN="--chroma-dir $REPO/data/sets/ahmed_oud/chroma"
      EXTRA_EVAL="--chroma-dir $REPO/data/sets/ahmed_oud/chroma --melody-refs data/sets/ahmed_oud/clips/test" ;;
    *) return 1 ;;
  esac
}

probe_metrics(){  # $1 = probe log; prints "<peak_driver_gb> <est_full_run_hours>" or "NA NA"
  "$PY" - "$1" <<'PYEOF'
import json, re, sys
txt = open(sys.argv[1], errors="replace").read()
blocks = re.findall(r"\{[^{}]*\"peak_driver_gb\"[^{}]*\}", txt, re.S)
if not blocks:
    print("NA NA"); sys.exit(0)
d = json.loads(blocks[-1])
print(d["peak_driver_gb"], d["est_full_run_hours"])
PYEOF
}

last_ckpt_step(){  # $1 = run dir; prints the highest ckpt_step_NNNN step, or 0
  local best=0 d s
  for d in "$1"/ckpt_step_*; do
    [ -d "$d" ] || continue
    s=$(echo "${d##*_}" | sed 's/^0*//'); s=${s:-0}
    [ "$s" -gt "$best" ] && best=$s
  done
  echo "$best"
}

has_adapter(){  # $1 = run dir; true when some ckpt_step_* holds a LoRA adapter
  local d
  for d in "$1"/ckpt_step_*; do [ -f "$d/adapter_config.json" ] && return 0; done
  return 1
}

train_ok(){ grep -q "SCALE_TRAIN_DONE" "$1" 2>/dev/null && tail -5 "$1" | grep -q "RUN_EXIT=0"; }

eval_complete(){  # $1 = eval json, $2 = head-to-head run ("" = none): the JSON exists and carries everything the recipe asked for
  [ -f "$1" ] || return 1
  [ -z "$2" ] || grep -q '"headtohead"' "$1"
}

last_exit(){ grep -o "$2=[0-9]*" "$1" 2>/dev/null | tail -1 | cut -d= -f2; }  # $1 = log, $2 = RUN_EXIT|EVAL_EXIT; empty when absent
h2h_state(){  # $1 = eval json, $2 = head-to-head run: "not requested" | "present" | "missing"
  if [ -z "$2" ]; then echo "not requested"; elif grep -q '"headtohead"' "$1" 2>/dev/null; then echo present; else echo missing; fi
}

ensure_ab_captions(){  # seed the shared Ahmed A/B caption list once, from consented rows only
  [ -f "$REPO/$AB_CAPTIONS" ] && return 0
  if [ ! -f "$AB_SEED_CAPTIONS" ]; then
    log "ab captions: $AB_SEED_CAPTIONS missing; the first eval seeds $AB_CAPTIONS from its own $AB_RIGHTS test rows"
    return 0
  fi
  log "ab captions: seeding $AB_CAPTIONS from $AB_SEED_CAPTIONS ($AB_N captions, rights $AB_RIGHTS)"
  if "$PY" - "$AB_SEED_CAPTIONS" "$REPO/$AB_CAPTIONS" "$AB_RIGHTS" "$AB_N" >> "$LOG" 2>&1 <<'PYEOF'
import sys
from pathlib import Path
from scripts.scale_eval import ab_captions
caps = ab_captions(Path(sys.argv[1]), int(sys.argv[4]), Path(sys.argv[2]), rights=[sys.argv[3]])
print(f"seeded {sys.argv[2]}: {len(caps)} captions")
PYEOF
  then log "ab captions: seeded"; else log "ab captions: seeding FAILED (see $LOG); the eval will try itself"; fi
}

run_one(){
  local run=$1
  local run_dir=$REPO/runs/$run
  local eval_json=$run_dir/eval_$run.json
  local train_log=$run_dir/train.log
  local eval_log=$run_dir/eval.log
  local probe_log=$run_dir/probe.log
  local resume="" last peak est cmd rc

  if ! recipe "$run"; then log "$run: unknown run, skipped"; return 0; fi
  if eval_complete "$eval_json" "$H2H_RUN"; then log "$run: eval JSON complete, skipping (idempotent)"; return 0; fi
  if [ -f "$eval_json" ]; then log "$run: eval JSON exists but lacks the head-to-head against $H2H_RUN; the eval reruns"; fi
  if [ ! -f "$CAPTIONS" ]; then log "$run: SKIP, captions file missing: $CAPTIONS"; return 0; fi
  if session_live "$run"; then
    log "$run: tmux session already live, not touching it; waiting for it to end"; wait_session "$run"
  fi
  mkdir -p "$run_dir"
  log "=== $run: $MODEL r$RANK a$ALPHA lr $LR $TOTAL_STEPS steps, captions $(wc -l < "$CAPTIONS" | tr -d ' ') rows ==="

  last=$(last_ckpt_step "$run_dir")
  if train_ok "$train_log"; then
    log "$run: training already complete (SCALE_TRAIN_DONE), going to eval"
  else
    if [ "$last" -ge "$TOTAL_STEPS" ]; then
      log "$run: last checkpoint is step $last, nothing left to train"
    else
      if [ "$last" -gt 0 ]; then
        resume="--resume-from $run_dir/$(printf 'ckpt_step_%04d' "$last") --start-step $last"
        log "$run: resuming after step $last (optimizer state not restored)"
      else
        # batch-size / memory probe
        log "$run: probe ($PROBE_STEPS smoke steps, grad-accum $GRAD_ACCUM) → $probe_log"
        caffeinate -s -i $ENV "$PY" -u -m scripts.scale_train --model "$MODEL" --run-id "${run}_probe" --smoke "$PROBE_STEPS" \
          --lr "$LR" --total-steps "$TOTAL_STEPS" --batch-size 1 --grad-accum "$GRAD_ACCUM" --rank "$RANK" --alpha "$ALPHA" \
          --captions "$CAPTIONS" --tokens-dir "$FALLBACK_TOKENS" --sample-seconds 5 --mem-cap-gb "$MEM_CAP_GB" $EXTRA_TRAIN \
          > "$probe_log" 2>&1
        read -r peak est <<EOF
$(probe_metrics "$probe_log")
EOF
        log "$run: probe peak_driver_gb=$peak est_full_run_hours=$est"
        if [ "$peak" = "NA" ]; then log "$run: ABORT, probe produced no report (see $probe_log)"; return 0; fi
        if awk -v p="$peak" -v c="$MEM_CAP_GB" 'BEGIN{exit !(p > c)}'; then
          log "$run: ABORT, probe peak ${peak} GB > cap ${MEM_CAP_GB} GB"; return 0
        fi
      fi
      cmd="caffeinate -s -i $ENV $PY -u -m scripts.scale_train --model $MODEL --run-id $run --lr $LR --total-steps $TOTAL_STEPS --ckpt-every $CKPT_EVERY --batch-size 1 --grad-accum $GRAD_ACCUM --rank $RANK --alpha $ALPHA --captions $CAPTIONS --tokens-dir $FALLBACK_TOKENS --sample-seconds 15 --mem-cap-gb $MEM_CAP_GB $EXTRA_TRAIN $resume >> $train_log 2>&1; echo RUN_EXIT=\$? >> $train_log"
      log "$run: launching tmux session $run"
      tmux new-session -d -s "$run" -c "$AI" "$cmd"
      sleep 5
      wait_session "$run"
      log "$run: training session ended: RUN_EXIT=$(last_exit "$train_log" RUN_EXIT)$(grep -q MEM_CAP_EXCEEDED "$train_log" && echo ' (MEM_CAP_EXCEEDED)')"
    fi
  fi

  last=$(last_ckpt_step "$run_dir")
  if [ "$last" -eq 0 ]; then log "$run: no checkpoint, skipping eval"; return 0; fi
  if ! train_ok "$train_log" && [ "$last" -lt "$TOTAL_STEPS" ]; then
    log "$run: training did not finish (last ckpt $last); rerun the orchestrator to resume; skipping eval"; return 0
  fi
  if [ -n "$H2H_RUN" ] && ! has_adapter "$REPO/$H2H_RUN"; then
    log "$run: head-to-head run $H2H_RUN has no adapter checkpoint; skipping eval (rerun the orchestrator once it has trained)"; return 0
  fi

  if session_live "${run}_eval"; then
    log "$run: eval session already live, waiting"; wait_session "${run}_eval"
  else
    ensure_ab_captions
    cmd="caffeinate -s -i $ENV $PY -u -m scripts.scale_eval --run runs/$run --model $MODEL --tag $run --captions $CAPTIONS --tokens-dir $FALLBACK_TOKENS --rank $RANK --alpha $ALPHA --n-ab $AB_N --ab-seconds 30 --ab-captions $AB_CAPTIONS --ab-rights $AB_RIGHTS $EXTRA_EVAL >> $eval_log 2>&1; echo EVAL_EXIT=\$? >> $eval_log"
    log "$run: launching tmux session ${run}_eval"
    tmux new-session -d -s "${run}_eval" -c "$AI" "$cmd"
    sleep 5
    wait_session "${run}_eval"
  fi
  rc=$(last_exit "$eval_log" EVAL_EXIT)
  if [ "${rc:-1}" = "0" ] && eval_complete "$eval_json" "$H2H_RUN"; then
    log "$run: eval done → $eval_json (EVAL_EXIT=0)"
  elif [ -f "$eval_json" ]; then
    log "$run: eval FAILED although $eval_json exists (EVAL_EXIT=${rc:-missing}; headtohead $(h2h_state "$eval_json" "$H2H_RUN"); see $eval_log)"
  else
    log "$run: eval FAILED, no $eval_json (EVAL_EXIT=${rc:-missing}; see $eval_log)"
  fi
}

cd "$AI" || { echo "cannot cd $AI"; exit 1; }
rm -f "$TOOLS/AHMED_ALL_DONE"
log "START orchestrate_ahmed (pid $$) runs: $RUNS; power: $(pmset -g batt | head -1)"
for run in $RUNS; do
  run_one "$run"
done
log "report: scripts.ahmed_report"
if "$PY" -m scripts.ahmed_report >> "$LOG" 2>&1; then log "report written (docs/eval/AHMED_TABLES.md)"; else log "report FAILED"; fi
touch "$TOOLS/AHMED_ALL_DONE"
log "AHMED_ALL_DONE"

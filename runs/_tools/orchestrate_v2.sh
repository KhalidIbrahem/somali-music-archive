#!/bin/bash
# Phase 2-5 orchestrator for the qaraami-v2 runs: A B C D in order, then E (DPO on
# the best of B/C), the improvement loop and the model report. bash 3.2 (macOS).
# Recipes live in recipes_v2.sh (recipe_v2 <run>); the proven helpers are copied
# from orchestrate_ahmed.sh (exact tmux matching, wait_session, probe_metrics,
# last_ckpt_step, has_adapter, train_ok, eval_complete, ensure_ab_captions).
#
#   A qaraami_medium_full  musicgen-medium  FULL decoder if the probe fits under 60 GB, else LoRA r64 a128; lr 2e-5
#   B qaraami_large        musicgen-large   LoRA r128 a256, lr 3e-5, + ahmed_mix
#   C qaraami_large_all    musicgen-large   B + harvard_full harvard_sep_oud (RESEARCH-ONLY adapter)
#   D qaraami_melody       musicgen-melody  LoRA r64 a128, lr 5e-5, MIDI chroma (rows' chroma_dir = data/sets/<set>/chroma_midi)
#   E dpo_v2_<best>        one DPO round on the best of B/C: 64 prompts x 4 samples at 15 s = 256 candidates
#   every run: batch 1, grad-accum 4, max 6000 steps, ckpt + validation every 250, early stop after 750 flat, mem cap 85 GB
#
# Per run, every step idempotent (skipped when its output exists) and resumable:
#   sets      the run's set names -> the ones whose data/sets/<set>/captions.jsonl exists (missing ones logged);
#             contributor oud sets join the releasable runs only with consented rights (recipes_v2.sh oud_sets)
#   merge     python -m scripts.build_sets --merge run_<run> --sets <existing>  -> data/sets/run_<run>_captions.jsonl
#             (melody: every row's chroma_dir is pointed at data/sets/<source>/chroma_midi; the run waits until
#             every row has its MIDI chroma)
#   rights    RIGHTS re-derived from the merged captions with register_adapter's rule (harvard_* rows or any
#             label outside ahmed_* / internet_cc / contrib_*_consented -> research_only); the recipe's value is
#             only ever tightened; remembered in runs/<run>/rights.txt (pick_best's tie-break reads B's)
#   tokens    scripts.scale_tokens for every set with clips that have no token .npy yet (resumable; a failed
#             check is a failure, never "complete")
#   probe     scale_train --smoke 20 -> runs/<run>/probe*.log; A first probes the full decoder and falls back to
#             LoRA when fits_under_60gb is false (decision remembered in runs/<run>/train_mode); abort if peak > cap
#   train     tmux session <run> under caffeinate -s -i, log runs/<run>/train.log; a killed run resumes from
#             its last ckpt_step_NNNN on the next orchestrator start; a run scale_train paused
#             (SCALE_TRAIN_PAUSED, --max-hours) is relaunched from that checkpoint at once; the full
#             decoder trains with --full-decoder --keep-last 3 (5 GB per checkpoint) and no LoRA args
#   eval      tmux session <run>_eval: scale_eval --n-ab 16 --ab-seconds 30 --mert-real 64
#             --ab-captions data/ab_captions_v2.json --ab-rights ahmed_ilkacase_consented internet_cc
#             (+ --turing 16 for the run flagged BEST) -> runs/<run>/eval_<run>.json
#   register  scripts.register_adapter --run runs/<run> --name <run> [--rights research_only] --restart
#             (writes services/musicgen-api/adapters.extra.json, kickstarts the service, waits for /health
#             to list the adapter and pre-warms it with one short generation); skipped when /health
#             already lists the adapter
# After D: BEST of B/C by mert.fad_adapter_real (lower) and per-song CE improvement (higher); when they
# disagree the releasable B wins (logged, runs/_tools/best_v2.json; an unreadable eval JSON counts as
# missing and is named). BEST gets the Turing eval, then E (scripts.dpo_train --tag v2_<best> --rounds 1
# -> runs/dpo_v2_<best>/summary.json, done only when "complete": true AND a ckpt_step_* alias holds the
# adapter; its own before/after listening set is data/ab_dpo_v2_<best>/ at 15 s), E's eval under the
# distinct tag dpo_v2_<best>_vs_base (data/ab_dpo_v2_<best>_vs_base/ base model vs DPO adapter at 30 s,
# data/ab_turing_dpo_v2_<best>_vs_base/, runs/dpo_v2_<best>/eval_dpo_v2_<best>_vs_base.json; the two
# A/B directories never collide) and its registration as dpo_v2_<best> (register_adapter --tag), then
# scripts.improve_loop --best-run runs/<best> and scripts.model_report (improve_loop keeps its own state
# in runs/_improve/state.json and is safe to rerun).
#
# State: runs/_tools/orchestrate_v2.log (every step, timestamped), runs/_tools/orchestrate_v2.status
# (json: current run, stage, started_at), runs/_tools/V2_ALL_DONE only when every stage of every run
# finished in a full pass (otherwise the log ends with V2_INCOMPLETE and the marker is absent).
#
# Flags:  --dry-run        print every command instead of running it (nothing written, no tmux)
#         --only <run>     one run only (A-D by name, or "post" for BEST/E/reports); no V2_ALL_DONE
#         --from <run>     start at that run and continue to the end; no V2_ALL_DONE
# Env:    MEM_CAP_GB (85) PROBE_STEPS (20) KEEP_LAST (3, full decoder) MAX_HOURS (0 = no pause budget)
#         MAX_RELAUNCH (12 pause relaunches per run) REGISTER_TIMEOUT_S (1800) IMPROVE_ARGS REPORT_ARGS
# Launch (Khalid only, AC power preferred; the loop is resumable on battery):
#   nohup bash runs/_tools/orchestrate_v2.sh > /dev/null 2>&1 &
#   bash runs/_tools/orchestrate_v2.sh --dry-run
set -u
REPO=${REPO:-$HOME/Projects/somali-music-archive}
AI=$REPO/apps/ai-service
TOOLS=$REPO/runs/_tools
PY=${PY:-$HOME/ai/musicgen-env/bin/python}
LOG=$TOOLS/orchestrate_v2.log
STATUS=$TOOLS/orchestrate_v2.status
DONE_MARK=$TOOLS/V2_ALL_DONE
BEST_FILE=$TOOLS/best_v2.json
# the recipes live next to this file (not under $REPO: tests source the helpers with REPO pointing at a fixture)
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$SELF_DIR/recipes_v2.sh"

MEM_CAP_GB=${MEM_CAP_GB:-85}
PROBE_STEPS=${PROBE_STEPS:-20}
GRAD_ACCUM=4
AB_N=16
AB_SECONDS=30
MERT_REAL=64
TURING_N=16
AB_CAPTIONS=data/ab_captions_v2.json                  # repo-relative, shared by every v2 eval
AB_RIGHTS="ahmed_ilkacase_consented internet_cc"      # only rows with these rights may seed it
FULL_DECODER_FLAG=--full-decoder                       # scale_train's full fine-tune switch (no LoRA arguments with it)
KEEP_LAST=${KEEP_LAST:-3}                             # full decoder: keep the best-val + the last N checkpoints (~5 GB each)
MAX_HOURS=${MAX_HOURS:-0}                             # scale_train --max-hours pause budget per launch (0 = off)
MAX_RELAUNCH=${MAX_RELAUNCH:-12}                      # relaunches of a run that paused with SCALE_TRAIN_PAUSED
API_URL=${MUSICGEN_API_URL:-http://127.0.0.1:8765}
REGISTER_TIMEOUT_S=${REGISTER_TIMEOUT_S:-1800}        # register_adapter --restart: wait for /health to list the adapter
DPO_PROMPTS=64; DPO_K=4; DPO_SECONDS=15; DPO_ROUNDS=1  # 256 candidates a round
IMPROVE_ARGS=${IMPROVE_ARGS:-}
REPORT_ARGS=${REPORT_ARGS:-}
ENV="env HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false"
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
ORCH_START=$(date '+%FT%T')

DRY=${ORCHESTRATE_V2_DRY:-0}; ONLY=""; FROM=""   # ORCHESTRATE_V2_DRY=1 = --dry-run (for the helpers sourced as a library)
usage(){ awk 'NR > 1 && /^set -u/ {exit} NR > 1' "$0" | sed 's/^# \{0,1\}//'; }   # the header comment above, whatever its length
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --only) ONLY=${2:-}; shift ;;
    --from) FROM=${2:-}; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
for name in $ONLY $FROM; do
  if [ "$name" != post ] && ! is_v2_run "$name"; then echo "unknown run: $name (runs: $V2_RUNS, or post)" >&2; exit 2; fi
done

# globals set per run by recipe_v2 / the stages
HAVE=""        # the run's sets that exist
MODE=lora      # lora | full (train mode decided by the probe)
BEST_RUN=none
STAGE_START=""
RUNS_OK=1      # 0 once any run of this pass stopped short (blocked/aborted/interrupted/eval_failed/register_failed): no V2_ALL_DONE then
PARTIAL=0      # 1 for --only / --from passes: they never write V2_ALL_DONE
[ -z "$ONLY$FROM" ] || PARTIAL=1
DPO_TAG=""; DPO_NAME=""; DPO_RUN_REL=""; DPO_EVAL_TAG=""; DPO_TRAIN_AB=""; DPO_EVAL_AB=""   # set by dpo_names

# ------------------------------------------------------------------ helpers
ts(){ date '+%F %T'; }
log(){ if [ "$DRY" = 1 ]; then echo "$(ts) $*"; else echo "$(ts) $*" | tee -a "$LOG"; fi; }
json_str(){ printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
set_status(){  # $1 run, $2 stage -> STATUS json (dry-run: logged only)
  STAGE_START=$(date '+%FT%T')
  log "STATUS run=$1 stage=$2"
  [ "$DRY" = 1 ] && return 0
  printf '{"run": "%s", "stage": "%s", "started_at": "%s", "orchestrator_started_at": "%s", "pid": %s, "dry_run": false}\n' \
    "$(json_str "$1")" "$(json_str "$2")" "$STAGE_START" "$ORCH_START" "$$" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}
sh_run(){  # $1 label, $2 command string, run in $AI (dry-run: printed)
  if [ "$DRY" = 1 ]; then echo "DRY   [$1] $2"; return 0; fi
  log "$1: $2"
  (cd "$AI" && bash -c "$2")
}
# "=name" makes tmux match the session name exactly (a bare "qaraami_large" would also match "qaraami_large_all")
session_live(){ tmux has-session -t "=$1" 2>/dev/null; }
wait_session(){ [ "$DRY" = 1 ] && return 0; while session_live "$1"; do sleep 30; done; }
tmux_run(){  # $1 session, $2 command string; returns when the session has ended (dry-run: printed)
  if [ "$DRY" = 1 ]; then echo "DRY   tmux new-session -d -s $1 -c $AI \"$2\""; return 0; fi
  log "launching tmux session $1: $2"
  tmux new-session -d -s "$1" -c "$AI" "$2"
  sleep 5
  wait_session "$1"
}

probe_metrics(){  # $1 = probe log; prints "<peak_driver_gb> <est_full_run_hours> <fits_under_60gb>" or "NA NA NA"
  [ -f "$1" ] || { echo "NA NA NA"; return 0; }
  "$PY" - "$1" <<'PYEOF'
import json, re, sys
txt = open(sys.argv[1], errors="replace").read()
blocks = re.findall(r"\{[^{}]*\"peak_driver_gb\"[^{}]*\}", txt, re.S)
if not blocks:
    print("NA NA NA"); sys.exit(0)
d = json.loads(blocks[-1])
fits = d.get("fits_under_60gb", d.get("under_60gb"))
print(d["peak_driver_gb"], d["est_full_run_hours"], "NA" if fits is None else str(bool(fits)).lower())
PYEOF
}
probe_has_report(){ [ "$(probe_metrics "$1" | cut -d' ' -f1)" != NA ]; }

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
has_ckpt(){  # $1 = run dir; true when some ckpt_step_* holds a LoRA adapter or full-decoder weights
  # (scale_train's full-decoder checkpoint is decoder.safetensors; each glob is tested on its own:
  # bash 3.2 has no nullglob, so one `ls a/*.safetensors a/*.bin` fails on the unmatched literal)
  local d f
  for d in "$1"/ckpt_step_*; do
    [ -d "$d" ] || continue
    [ -f "$d/adapter_config.json" ] && return 0
    [ -f "$d/decoder.safetensors" ] && return 0
    for f in "$d"/*.safetensors "$d"/*.bin; do [ -f "$f" ] && return 0; done
  done
  return 1
}
dpo_complete(){  # $1 = runs/dpo_<tag> dir: summary.json says complete AND a ckpt_step_* alias holds the adapter
  grep -q '"complete": true' "$1/summary.json" 2>/dev/null && has_ckpt "$1"
}
dpo_stopped(){  # $1 = runs/dpo_<tag> dir: the summary's "stopped" reason, "" when none
  [ -f "$1/summary.json" ] || { echo ""; return 0; }
  "$PY" -c 'import json, sys
try:
    print(json.load(open(sys.argv[1])).get("stopped") or "")
except Exception:
    print("")' "$1/summary.json" 2>/dev/null
}
train_ok(){ grep -q "SCALE_TRAIN_DONE" "$1" 2>/dev/null && tail -5 "$1" | grep -q "RUN_EXIT=0"; }
eval_complete(){  # $1 = eval json, $2 = 1 when the Turing set is required: the JSON exists and carries what was asked
  [ -f "$1" ] || return 1
  [ "$2" != 1 ] || grep -q '"turing"' "$1"
}
last_exit(){ grep -o "$2=[0-9]*" "$1" 2>/dev/null | tail -1 | cut -d= -f2; }  # $1 = log, $2 = RUN_EXIT|EVAL_EXIT|DPO_EXIT

ensure_ab_captions(){  # seed the shared v2 A/B caption list once, from consented test rows of the current run's captions
  [ -f "$REPO/$AB_CAPTIONS" ] && return 0
  if [ "$DRY" = 1 ]; then echo "DRY   [ab captions] seed $AB_CAPTIONS from $CAPTIONS test rows with rights [$AB_RIGHTS] via scripts.scale_eval.ab_captions (n=$AB_N)"; return 0; fi
  if [ ! -f "$CAPTIONS" ]; then log "ab captions: $CAPTIONS missing; the first eval seeds $AB_CAPTIONS from its own test rows"; return 0; fi
  log "ab captions: seeding $AB_CAPTIONS from $CAPTIONS ($AB_N captions, rights $AB_RIGHTS)"
  if "$PY" - "$CAPTIONS" "$REPO/$AB_CAPTIONS" "$AB_N" $AB_RIGHTS >> "$LOG" 2>&1 <<'PYEOF'
import sys
from pathlib import Path
from scripts.scale_eval import ab_captions
caps = ab_captions(Path(sys.argv[1]), int(sys.argv[3]), Path(sys.argv[2]), rights=sys.argv[4:])
print(f"seeded {sys.argv[2]}: {len(caps)} captions")
PYEOF
  then log "ab captions: seeded"; else log "ab captions: seeding FAILED (see $LOG); the eval will try itself"; fi
}

adapter_served(){  # $1 name: true when the service's /health lists it as loaded
  curl -s -m 10 "$API_URL/health" 2>/dev/null | "$PY" -c 'import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
sys.exit(0 if sys.argv[1] in d.get("adapters_loaded", []) else 1)' "$1" 2>/dev/null
}

best_ckpt(){  # $1 run dir: the best SAVED LoRA checkpoint (scale_eval.find_best_ckpt), "" when none
  [ -d "$1" ] || { echo ""; return 0; }
  "$PY" - "$1" <<'PYEOF'
import sys
from pathlib import Path
from scripts.scale_eval import find_best_ckpt
p = find_best_ckpt(Path(sys.argv[1]))
print(p if (p / "adapter_config.json").exists() else "")
PYEOF
}

# ------------------------------------------------------------------- stages
resolve_sets(){  # $1 run: HAVE = the run's sets that are built; the others are logged
  local missing
  HAVE=$(existing_sets $SETS 2>/dev/null)
  missing=$(missing_sets $SETS)
  [ -z "$missing" ] || log "$1: sets not built yet, skipped: $missing"
  log "$1: sets to merge: ${HAVE:-none}"
}

rewrite_chroma(){  # $1 run (melody): every row's chroma_dir -> data/sets/<source>/chroma_midi; the run waits until all rows have it
  local run=$1
  if [ "$DRY" = 1 ]; then echo "DRY   [$run chroma] rewrite chroma_dir -> data/sets/<source>/$V2_MELODY_CHROMA in $CAPTIONS and check every row has its .npy (inline python)"; return 0; fi
  if "$PY" - "$CAPTIONS" "$V2_MELODY_CHROMA" >> "$LOG" 2>&1 <<'PYEOF'
import json, sys
from pathlib import Path
from scripts.scale_train import chroma_path
cap, sub = Path(sys.argv[1]), sys.argv[2]
rows = [json.loads(l) for l in open(cap)]
for r in rows:
    r["chroma_dir"] = f"data/sets/{r['source']}/{sub}"
missing = [r["clip_path"] for r in rows if not chroma_path(None, r).exists()]
print(f"{sub}: {len(rows) - len(missing)}/{len(rows)} rows have their MIDI chroma")
if missing:
    print(f"MISSING_CHROMA {len(missing)} rows, e.g. {missing[0]}")
    sys.exit(4)
tmp = cap.with_suffix(".tmp")
with open(tmp, "w") as fh:
    for r in rows:
        fh.write(json.dumps(r) + "\n")
tmp.replace(cap)
PYEOF
  then log "$run: chroma_dir rewritten to $V2_MELODY_CHROMA for every row"
  else
    rm -f "$CAPTIONS"
    log "$run: SKIP, rows without MIDI chroma (scripts.melody_midi has not covered every set); $CAPTIONS removed so the next start re-merges"
    return 1
  fi
}

merge_captions(){  # $1 run: data/sets/run_<run>_captions.jsonl from the existing sets (kept once it exists)
  local run=$1 run_dir=$REPO/runs/$1
  if [ -s "$CAPTIONS" ]; then
    log "$run: captions exist ($CAPTIONS, $(wc -l < "$CAPTIONS" | tr -d ' ') rows), merge skipped (idempotent)"
    if [ -f "$run_dir/sets.txt" ] && [ "$(cat "$run_dir/sets.txt")" != "$HAVE" ]; then
      log "$run: WARNING the built sets changed since the merge ($(cat "$run_dir/sets.txt") -> $HAVE); delete $CAPTIONS to re-merge (not done automatically: a run in progress keeps its captions)"
    fi
    return 0
  fi
  [ -n "$HAVE" ] || { log "$run: SKIP, none of its sets is built"; return 1; }
  sh_run "$run merge" "$ENV $PY -m scripts.build_sets --merge run_$run --sets $HAVE >> $TOOLS/merge_$run.log 2>&1" \
    || { log "$run: merge FAILED (see $TOOLS/merge_$run.log)"; return 1; }
  if [ "$DRY" != 1 ]; then
    [ -s "$CAPTIONS" ] || { log "$run: merge produced no $CAPTIONS"; return 1; }
    mkdir -p "$run_dir"; echo "$HAVE" > "$run_dir/sets.txt"
  fi
  if [ "$MODEL" = facebook/musicgen-melody ]; then rewrite_chroma "$run" || return 1; fi
  return 0
}

tokens_missing(){  # $1 set: prints "<clips without tokens> <seconds> <tokens dir>"
  "$PY" - "$SETS_ROOT/$1" <<'PYEOF'
import json, sys
from pathlib import Path
from scripts.scale_train import resolve_repo_path, token_path
d = Path(sys.argv[1])
rows = [json.loads(l) for l in open(d / "captions.jsonl")]
default = d / "tokens"
tdir = resolve_repo_path(rows[0]["tokens_dir"]) if rows and rows[0].get("tokens_dir") else default
missing = sum(1 for r in rows if not token_path(default, r).exists())
print(missing, rows[0].get("seconds", 30.0) if rows else 30.0, tdir)
PYEOF
}
ensure_tokens(){  # $1 run: EnCodec tokens for every set of the run (scale_tokens skips existing .npy)
  local run=$1 s missing secs tdir out rc
  for s in $HAVE; do
    out=$(tokens_missing "$s" 2>&1); rc=$?
    read -r missing secs tdir <<EOF
$(printf '%s\n' "$out" | tail -1)
EOF
    case "$rc:$missing" in
      0:[0-9]*) : ;;   # a count; anything else is a failed check (a traceback's last line, or nothing), never "complete"
      *) log "$run: token check for $s FAILED (rc=$rc: ${missing:-no output}); not treating its tokens as complete"; return 1 ;;
    esac
    if [ "$missing" = 0 ]; then log "$run: tokens complete for $s"; continue; fi
    log "$run: $s has $missing clips without tokens; encoding (facebook/encodec_32khz, ${secs} s) -> $tdir"
    sh_run "$run tokens $s" "caffeinate -s -i $ENV $PY -u -m scripts.scale_tokens --captions $SETS_ROOT/$s/captions.jsonl --tokens-dir $tdir --seconds $secs >> $TOOLS/tokens_$s.log 2>&1" \
      || { log "$run: tokenising $s FAILED (see $TOOLS/tokens_$s.log)"; return 1; }
  done
  return 0
}

probe_cmd(){  # $1 run, $2 flags (LoRA rank/alpha or the full-decoder switch), $3 log
  echo "caffeinate -s -i $ENV $PY -u -m scripts.scale_train --model $MODEL --run-id ${1}_probe --smoke $PROBE_STEPS --lr $LR --total-steps $MAX_STEPS --batch-size 1 --grad-accum $GRAD_ACCUM $2 --captions $CAPTIONS --sample-seconds 5 $EXTRA_TRAIN > $3 2>&1"
}

decide_mode(){  # $1 run: MODE = full | lora. Only FULL_DECODER=1 runs probe the full decoder; the decision is remembered
  local run=$1 run_dir=$REPO/runs/$1 mode_file=$REPO/runs/$1/train_mode probe_log=$REPO/runs/$1/probe_full.log peak est fits
  MODE=lora
  [ "$FULL_DECODER" = 1 ] || return 0
  if [ -f "$mode_file" ]; then MODE=$(cat "$mode_file"); log "$run: train mode $MODE (remembered in $mode_file)"; return 0; fi
  if [ "$(last_ckpt_step "$run_dir")" -gt 0 ]; then
    if has_adapter "$run_dir"; then MODE=lora; else MODE=full; fi
    log "$run: train mode $MODE inferred from the existing checkpoints"
    [ "$DRY" = 1 ] || echo "$MODE" > "$mode_file"
    return 0
  fi
  if ! probe_has_report "$probe_log"; then
    [ "$DRY" = 1 ] || mkdir -p "$run_dir"
    log "$run: probe the FULL decoder ($PROBE_STEPS smoke steps, grad-accum $GRAD_ACCUM) -> $probe_log"
    sh_run "$run probe(full)" "$(probe_cmd "$run" "$FULL_DECODER_FLAG" "$probe_log")"
  fi
  read -r peak est fits <<EOF
$(probe_metrics "$probe_log")
EOF
  log "$run: full-decoder probe peak_driver_gb=$peak est_full_run_hours=$est fits_under_60gb=$fits"
  if [ "$fits" = NA ]; then
    if [ "$DRY" = 1 ]; then log "$run: dry-run, no probe report; assuming the full decoder fits under 60 GB"; MODE=full; return 0; fi
    log "$run: full-decoder probe gave no report (see $probe_log) -> fallback LoRA r$RANK a$ALPHA"; MODE=lora
  elif [ "$fits" = true ]; then
    MODE=full
  else
    log "$run: the full decoder does not fit under 60 GB (fits_under_60gb=$fits) -> fallback LoRA r$RANK a$ALPHA"; MODE=lora
  fi
  [ "$DRY" = 1 ] || { mkdir -p "$run_dir"; echo "$MODE" > "$mode_file"; }   # a dry run writes nothing
  return 0
}

probe_run(){  # $1 run: the batch-size / memory probe in the decided mode; abort the run when the peak exceeds the cap
  local run=$1 run_dir=$REPO/runs/$1 probe_log flags peak est fits
  if [ "$(last_ckpt_step "$run_dir")" -gt 0 ]; then log "$run: checkpoints exist, probe skipped"; return 0; fi
  if [ "$MODE" = full ]; then probe_log=$run_dir/probe_full.log; flags=$FULL_DECODER_FLAG; else probe_log=$run_dir/probe.log; flags="--rank $RANK --alpha $ALPHA"; fi
  if [ "$MODE" = full ]; then
    log "$run: full-decoder probe already run by the mode decision ($probe_log); checking the cap"
  elif probe_has_report "$probe_log"; then
    log "$run: probe report present in $probe_log"
  else
    [ "$DRY" = 1 ] || mkdir -p "$run_dir"
    log "$run: probe($MODE) ($PROBE_STEPS smoke steps, grad-accum $GRAD_ACCUM) -> $probe_log"
    sh_run "$run probe($MODE)" "$(probe_cmd "$run" "$flags" "$probe_log")"
  fi
  read -r peak est fits <<EOF
$(probe_metrics "$probe_log")
EOF
  log "$run: probe($MODE) peak_driver_gb=$peak est_full_run_hours=$est fits_under_60gb=$fits"
  if [ "$peak" = NA ]; then
    [ "$DRY" = 1 ] && { log "$run: dry-run, no probe report; continuing"; return 0; }
    log "$run: ABORT, probe produced no report (see $probe_log)"; return 1
  fi
  if awk -v p="$peak" -v c="$MEM_CAP_GB" 'BEGIN{exit !(p > c)}'; then
    log "$run: ABORT, probe peak ${peak} GB > cap ${MEM_CAP_GB} GB"; return 1
  fi
  return 0
}

train_paused(){ tail -5 "$1" 2>/dev/null | grep -q "SCALE_TRAIN_PAUSED"; }  # --max-hours pause: resume at once

train_run(){  # $1 run: tmux <run> under caffeinate; resumes from the last checkpoint; relaunches after a --max-hours pause
  local run=$1 run_dir=$REPO/runs/$1 train_log=$REPO/runs/$1/train.log last resume flags relaunch=0
  if [ "$MODE" = full ]; then flags="$FULL_DECODER_FLAG --keep-last $KEEP_LAST"; else flags="--rank $RANK --alpha $ALPHA"; fi
  [ "$MAX_HOURS" = 0 ] || flags="$flags --max-hours $MAX_HOURS"
  while :; do
    if train_ok "$train_log"; then log "$run: training complete (SCALE_TRAIN_DONE)$(grep -qi 'EARLY_STOP step' "$train_log" && echo ' after an early stop')"; return 0; fi
    last=$(last_ckpt_step "$run_dir")
    if [ "$last" -ge "$MAX_STEPS" ]; then log "$run: last checkpoint is step $last = MAX_STEPS, nothing left to train"; return 0; fi
    if session_live "$run"; then
      log "$run: tmux session $run already live, not touching it; waiting"; wait_session "$run"
      continue
    fi
    resume=""
    if [ "$last" -gt 0 ]; then
      resume="--resume-from $run_dir/$(printf 'ckpt_step_%04d' "$last") --start-step $last"
      log "$run: resuming after step $last (optimizer state not restored)"
    fi
    [ "$DRY" = 1 ] || mkdir -p "$run_dir"
    tmux_run "$run" "caffeinate -s -i $ENV $PY -u -m scripts.scale_train --model $MODEL --run-id $run --lr $LR --total-steps $MAX_STEPS --batch-size 1 --grad-accum $GRAD_ACCUM $flags --captions $CAPTIONS --sample-seconds 15 $EXTRA_TRAIN $resume >> $train_log 2>&1; echo RUN_EXIT=\$? >> $train_log"
    [ "$DRY" = 1 ] && return 0
    log "$run: training session ended: RUN_EXIT=$(last_exit "$train_log" RUN_EXIT)$(grep -q MEM_CAP_EXCEEDED "$train_log" && echo ' (MEM_CAP_EXCEEDED)')$(grep -qi 'EARLY_STOP step' "$train_log" && echo ' (early stop)')$(train_paused "$train_log" && echo ' (paused by --max-hours)')"
    train_ok "$train_log" && continue
    if train_paused "$train_log" && [ "$relaunch" -lt "$MAX_RELAUNCH" ]; then
      relaunch=$((relaunch + 1)); log "$run: paused with a checkpoint; relaunching ($relaunch/$MAX_RELAUNCH)"; continue
    fi
    log "$run: training did not finish (last ckpt $(last_ckpt_step "$run_dir")); rerun the orchestrator to resume"; return 1
  done
}

eval_run(){  # $1 run (recipe), $2 = 1 for the Turing set, $3 run dir repo-relative (default runs/<run>), $4 tag (default run)
  local run=$1 turing=$2 run_rel=${3:-runs/$1} tag=${4:-$1} run_dir eval_json eval_log extra="" rc
  run_dir=$REPO/$run_rel; eval_json=$run_dir/eval_$tag.json; eval_log=$run_dir/eval.log
  if eval_complete "$eval_json" "$turing"; then log "$tag: eval complete ($eval_json), skipped (idempotent)"; return 0; fi
  [ -f "$eval_json" ] && log "$tag: eval JSON exists but lacks the Turing set; the eval reruns with --turing $TURING_N"
  if [ "$DRY" != 1 ] && ! has_ckpt "$run_dir"; then log "$tag: no checkpoint under $run_dir, eval skipped"; return 1; fi
  [ "$turing" = 1 ] && extra="--turing $TURING_N"
  if session_live "${tag}_eval"; then
    log "$tag: eval session already live, waiting"; wait_session "${tag}_eval"
  else
    ensure_ab_captions
    tmux_run "${tag}_eval" "caffeinate -s -i $ENV $PY -u -m scripts.scale_eval --run $run_rel --model $MODEL --tag $tag --captions $CAPTIONS --rank $RANK --alpha $ALPHA --n-ab $AB_N --ab-seconds $AB_SECONDS --mert-real $MERT_REAL --ab-captions $AB_CAPTIONS --ab-rights $AB_RIGHTS $EXTRA_EVAL $extra >> $eval_log 2>&1; echo EVAL_EXIT=\$? >> $eval_log"
  fi
  [ "$DRY" = 1 ] && return 0
  rc=$(last_exit "$eval_log" EVAL_EXIT)
  if [ "${rc:-1}" = 0 ] && eval_complete "$eval_json" "$turing"; then log "$tag: eval done -> $eval_json (EVAL_EXIT=0)"; return 0; fi
  if [ -f "$eval_json" ]; then log "$tag: eval FAILED although $eval_json exists (EVAL_EXIT=${rc:-missing}; see $eval_log)"
  else log "$tag: eval FAILED, no $eval_json (EVAL_EXIT=${rc:-missing}; see $eval_log)"; fi
  return 1
}

register_run(){  # $1 name, $2 run dir repo-relative, $3 rights, $4 eval tag (default: the name): scripts.register_adapter --restart (registry entry, kickstart, wait, pre-warm)
  local name=$1 run_rel=$2 rights=$3 tag=${4:-$1} flag=""
  if [ ! -f "$AI/scripts/register_adapter.py" ]; then log "$name: scripts/register_adapter.py not built yet; registration skipped (rerun the orchestrator later)"; return 1; fi
  if [ "$DRY" != 1 ] && adapter_served "$name"; then log "$name: already served by $API_URL, registration skipped (idempotent)"; return 0; fi
  [ "$rights" = research_only ] && flag="--rights research_only"   # releasable runs: derived from the captions (never past Harvard rows)
  [ "$tag" = "$name" ] || flag="${flag:+$flag }--tag $tag"         # the DPO run's eval JSON carries DPO_EVAL_TAG, not the adapter name
  sh_run "$name register" "$ENV $PY -m scripts.register_adapter --run $run_rel --name $name $flag --restart --timeout $REGISTER_TIMEOUT_S >> $TOOLS/register_$name.log 2>&1" \
    || { log "$name: registration FAILED (see $TOOLS/register_$name.log)"; return 1; }
  [ "$DRY" = 1 ] && return 0
  if adapter_served "$name"; then log "$name: registered, served and pre-warmed ($TOOLS/register_$name.log)"
  else log "$name: registered but not yet listed by $API_URL/health (see $TOOLS/register_$name.log)"; fi
  return 0
}

captions_rights(){  # $1 captions: prints "<releasable|research_only> <labels that decided it>" by register_adapter's rule; "" on failure
  [ -s "$1" ] || { echo ""; return 0; }
  "$PY" - "$1" 2>/dev/null <<'PYEOF'
import json, sys
from pathlib import Path
cap = Path(sys.argv[1])
try:
    from scripts.register_adapter import derive_rights, rights_histogram
    rights, reasons = derive_rights(rights_histogram(cap))
    why = reasons["harvard"] + reasons["unknown"]
except ImportError:  # the same rule, locally: harvard rows or any label outside the releasable set -> research_only
    labels = set()
    for line in open(cap):
        if line.strip():
            r = json.loads(line)
            labels.add(str(r.get("rights") or ("harvard" if str(r.get("source", "")).startswith("harvard") else "unlabelled")))
    ok = lambda x: x.startswith("ahmed_") or x == "internet_cc" or (x.startswith("contrib_") and x.endswith("_consented"))  # noqa: E731
    why = sorted(x for x in labels if not ok(x))
    rights = "research_only" if why else "releasable"
print(rights, ",".join(why))
PYEOF
}
check_rights(){  # $1 run: RIGHTS re-derived from the merged captions; the recipe's value is only ever tightened, and remembered in runs/<run>/rights.txt
  local run=$1 run_dir=$REPO/runs/$1 derived labels excluded
  excluded=$(contrib_research_sets)
  [ -z "$excluded" ] || log "$run: contributor oud sets with research-only or unlabelled rights are never merged into a releasable run: $excluded"
  if [ ! -s "$CAPTIONS" ]; then log "$run: rights check waits for the merge ($CAPTIONS not there yet); keeping the recipe's rights=$RIGHTS"; return 0; fi
  read -r derived labels <<EOF
$(captions_rights "$CAPTIONS")
EOF
  if [ -z "$derived" ]; then log "$run: rights could not be derived from $CAPTIONS (python failed); keeping the recipe's rights=$RIGHTS"; return 0; fi
  if [ "$derived" = research_only ] && [ "$RIGHTS" = releasable ]; then
    log "$run: WARNING the merged captions carry rights outside the releasable set ($labels): the recipe says releasable but this adapter is RESEARCH-ONLY; registering it as research_only"
    RIGHTS=research_only
  elif [ "$derived" != "$RIGHTS" ]; then
    log "$run: captions derive $derived, the recipe says $RIGHTS; keeping the recipe's (never loosened)"
  else
    log "$run: rights=$RIGHTS confirmed by the captions${labels:+ ($labels)}"
  fi
  [ "$DRY" = 1 ] || { mkdir -p "$run_dir"; echo "$RIGHTS" > "$run_dir/rights.txt"; }
  return 0
}

run_one(){  # the A-D pipeline for one run; every stage returns early when a rerun is needed (RUNS_OK=0 then)
  local run=$1 what
  if ! recipe_v2 "$run"; then log "$run: unknown run, skipped"; return 0; fi
  if [ "$FULL_DECODER" = 1 ]; then what="FULL decoder (fallback LoRA r$RANK a$ALPHA)"; else what="LoRA r$RANK a$ALPHA"; fi
  log "=== $run: $MODEL $what lr $LR max $MAX_STEPS steps rights=$RIGHTS sets: $SETS ==="
  set_status "$run" sets;     resolve_sets "$run"
  set_status "$run" merge;    merge_captions "$run" || { set_status "$run" blocked; RUNS_OK=0; return 0; }
  set_status "$run" rights;   check_rights "$run"
  set_status "$run" tokens;   ensure_tokens "$run" || { set_status "$run" blocked; RUNS_OK=0; return 0; }
  set_status "$run" probe;    decide_mode "$run"; probe_run "$run" || { set_status "$run" aborted; RUNS_OK=0; return 0; }
  set_status "$run" train;    train_run "$run" || { set_status "$run" interrupted; RUNS_OK=0; return 0; }
  set_status "$run" eval;     eval_run "$run" 0 || { set_status "$run" eval_failed; RUNS_OK=0; return 0; }
  set_status "$run" register; register_run "$run" "runs/$run" "$RIGHTS" || { set_status "$run" register_failed; RUNS_OK=0; return 0; }
  set_status "$run" done
}

pick_best(){  # BEST_RUN from runs B/C: mert.fad_adapter_real (lower) and per-song CE improvement (higher); disagreement -> releasable B
  local line best why fb fc cb cc b_rights
  b_rights=$(cat "$REPO/runs/qaraami_large/rights.txt" 2>/dev/null || echo releasable)
  line=$("$PY" - "$REPO/runs/qaraami_large/eval_qaraami_large.json" "$REPO/runs/qaraami_large_all/eval_qaraami_large_all.json" "$b_rights" 2>/dev/null <<'PYEOF'
import json, sys
from pathlib import Path
B_NAME, C_NAME = "qaraami_large", "qaraami_large_all"
notes = []
def load(p):
    p = Path(p)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception as exc:  # an unreadable eval JSON counts as missing, and is named in the reason
        notes.append(f"{p.name} unreadable ({type(exc).__name__}), treated as missing")
        return None
def fad(d):
    return ((d or {}).get("mert") or {}).get("fad_adapter_real")
def ce(d):
    return (((d or {}).get("per_song_ce") or {}).get("improvement_base_minus_adapter") or {}).get("mean")
B, C = load(sys.argv[1]), load(sys.argv[2])
b_tag = "the releasable B" if sys.argv[3] == "releasable" else "B (the brief's tie-break; NOTE its captions derive research_only)"
fb, fc, cb, cc = fad(B), fad(C), ce(B), ce(C)
if B is None and C is None:
    best, why = "none", "no eval JSON for B or C yet"
elif C is None:
    best, why = B_NAME, "only B is evaluated"
elif B is None:
    best, why = C_NAME, "only C is evaluated (research-only)"
else:
    by_fad = None if None in (fb, fc) else (B_NAME if fb <= fc else C_NAME)
    by_ce = None if None in (cb, cc) else (B_NAME if cb >= cc else C_NAME)
    if by_fad and by_ce and by_fad == by_ce:
        best, why = by_fad, "MERT FAD and per-song CE agree"
    elif by_fad and by_ce:
        best, why = B_NAME, f"metrics disagree (FAD prefers {by_fad}, CE prefers {by_ce}): {b_tag} is preferred"
    elif by_fad or by_ce:
        best, why = (by_fad or by_ce), "one metric missing; decided on the other"
    else:
        best, why = B_NAME, f"both metrics missing from the eval JSONs; {b_tag} is preferred"
if notes:
    why += "; " + "; ".join(notes)
print("|".join(str(x).replace("|", "/") for x in (best, why, fb, fc, cb, cc)))
PYEOF
)
  IFS='|' read -r best why fb fc cb cc <<EOF
$line
EOF
  if [ -z "$best" ]; then best=none; why="pick_best could not read the eval JSONs (python failed; run it by hand: see $LOG)"; fi
  BEST_RUN=$best
  log "BEST of B/C: $best ($why); fad_adapter_real B=$fb C=$fc; per-song CE improvement B=$cb C=$cc"
  if [ "$DRY" = 1 ]; then
    [ "$BEST_RUN" = none ] && { BEST_RUN=qaraami_large; log "dry-run: assuming BEST=$BEST_RUN to print the E commands"; }
    return 0
  fi
  [ "$BEST_RUN" = none ] && return 0
  printf '{"best": "%s", "reason": "%s", "fad_adapter_real": {"qaraami_large": %s, "qaraami_large_all": %s}, "per_song_ce_improvement": {"qaraami_large": %s, "qaraami_large_all": %s}, "decided_at": "%s"}\n' \
    "$best" "$(json_str "$why")" "$(json_num "$fb")" "$(json_num "$fc")" "$(json_num "$cb")" "$(json_num "$cc")" "$(date '+%FT%T')" > "$BEST_FILE"
  return 0
}
json_num(){ case "$1" in None|NA|"") echo null ;; *) echo "$1" ;; esac; }

dpo_stage(){  # E: one DPO round on BEST (256 candidates), eval with the Turing set, register
  local best=$BEST_RUN dpo_dir ckpt prompts_from stopped
  recipe_v2 "$best" || return 1
  [ -f "$REPO/runs/$best/rights.txt" ] && RIGHTS=$(cat "$REPO/runs/$best/rights.txt")   # the rights check_rights derived for the parent run
  MODE=lora
  dpo_names "$best"; dpo_dir=$REPO/$DPO_RUN_REL
  # two A/B directories, never the same: dpo_train's before/after set $DPO_TRAIN_AB (15 s) and
  # scale_eval's base-model-vs-DPO set $DPO_EVAL_AB (30 s, tag $DPO_EVAL_TAG); the eval overwrote the other otherwise
  prompts_from=$SETS_ROOT/run_qaraami_medium_full_captions.jsonl   # isolated-oud captions as prompts (A's merge) when built
  [ -s "$prompts_from" ] || prompts_from=$CAPTIONS
  if dpo_complete "$dpo_dir"; then
    log "E: $dpo_dir/summary.json is complete and holds an adapter, DPO skipped (idempotent)"
  elif session_live "$DPO_NAME"; then
    log "E: tmux session $DPO_NAME already live, waiting"; wait_session "$DPO_NAME"
  else
    stopped=$(dpo_stopped "$dpo_dir")
    [ -z "$stopped" ] || log "E: the previous DPO attempt produced no adapter ($stopped); running it again (same seeds: change --margin or the prompts if it repeats)"
    ckpt=$(best_ckpt "$REPO/runs/$best")
    if [ -z "$ckpt" ]; then
      if [ "$DRY" = 1 ]; then ckpt="$REPO/runs/$best/ckpt_step_NNNN"; log "dry-run: $best has no checkpoint yet; printing with a placeholder"; else log "E: $best has no LoRA checkpoint; DPO skipped"; return 1; fi
    fi
    log "E: DPO on $best from $ckpt: $DPO_PROMPTS prompts x $DPO_K samples at $DPO_SECONDS s = $((DPO_PROMPTS * DPO_K)) candidates a round, $DPO_ROUNDS round; prompts from $prompts_from; A/B sets $DPO_TRAIN_AB (before/after) and $DPO_EVAL_AB (vs base)"
    [ "$DRY" = 1 ] || mkdir -p "$dpo_dir"
    tmux_run "$DPO_NAME" "caffeinate -s -i $ENV $PY -u -m scripts.dpo_train --model $MODEL --adapter $ckpt --tag $DPO_TAG --reward full --prompts-per-round $DPO_PROMPTS --samples-per-prompt $DPO_K --seconds $DPO_SECONDS --rounds $DPO_ROUNDS --captions $CAPTIONS --prompts-from $prompts_from --mem-cap-gb $MEM_CAP_GB >> $dpo_dir/dpo.log 2>&1; echo DPO_EXIT=\$? >> $dpo_dir/dpo.log"
  fi
  if [ "$DRY" != 1 ] && ! dpo_complete "$dpo_dir"; then
    stopped=$(dpo_stopped "$dpo_dir")
    log "E: DPO did not complete with an adapter (DPO_EXIT=$(last_exit "$dpo_dir/dpo.log" DPO_EXIT)${stopped:+; $stopped}; see $dpo_dir/dpo.log); rerun the orchestrator"; return 1
  fi
  set_status "$DPO_NAME" eval;     eval_run "$best" 1 "$DPO_RUN_REL" "$DPO_EVAL_TAG" || return 1
  set_status "$DPO_NAME" register; register_run "$DPO_NAME" "$DPO_RUN_REL" "$RIGHTS" "$DPO_EVAL_TAG" || return 1
  set_status "$DPO_NAME" done
}

final_stage(){  # Phase 4-5 runners; returns 1 when either did not finish (a missing script counts: the marker means all done)
  local ok=0
  if [ -f "$AI/scripts/improve_loop.py" ]; then
    if [ -f "$TOOLS/IMPROVE_V2_DONE" ]; then log "post: improve_loop already done ($TOOLS/IMPROVE_V2_DONE), skipped"
    else
      set_status post improve_loop
      if session_live improve_v2; then log "post: tmux session improve_v2 already live, waiting"; wait_session improve_v2
      else tmux_run improve_v2 "caffeinate -s -i $ENV $PY -u -m scripts.improve_loop --best-run runs/$BEST_RUN $IMPROVE_ARGS >> $TOOLS/improve_v2.log 2>&1; echo IMPROVE_EXIT=\$? >> $TOOLS/improve_v2.log"; fi
      if [ "$DRY" != 1 ]; then
        if [ "$(last_exit "$TOOLS/improve_v2.log" IMPROVE_EXIT)" = 0 ]; then touch "$TOOLS/IMPROVE_V2_DONE"; log "post: improve_loop done (docs/eval/IMPROVEMENT_LOG.md)"
        else log "post: improve_loop FAILED (IMPROVE_EXIT=$(last_exit "$TOOLS/improve_v2.log" IMPROVE_EXIT); see $TOOLS/improve_v2.log)"; ok=1; fi
      fi
    fi
  else log "post: scripts/improve_loop.py not built yet; skipped"; ok=1; fi
  if [ -f "$AI/scripts/model_report.py" ]; then
    set_status post model_report
    if sh_run "post model_report" "$ENV $PY -m scripts.model_report $REPORT_ARGS >> $TOOLS/model_report_v2.log 2>&1"; then [ "$DRY" = 1 ] || log "post: model report written (docs/eval/QARAAMI_MODEL_REPORT.md)"
    else log "post: model_report FAILED (see $TOOLS/model_report_v2.log)"; ok=1; fi
  else log "post: scripts/model_report.py not built yet; skipped"; ok=1; fi
  return $ok
}

post_stage(){  # after D: BEST, its Turing eval, E, the loop and the report; V2_ALL_DONE only when every stage of every run finished
  local post_ok=1
  set_status post best
  pick_best
  if [ "$BEST_RUN" = none ]; then log "post: no evaluated B/C run; E and the reports wait for a rerun (V2_INCOMPLETE)"; set_status post incomplete; return 0; fi
  recipe_v2 "$BEST_RUN" || { log "post: BEST=$BEST_RUN is not a recipe (V2_INCOMPLETE)"; set_status post incomplete; return 1; }
  MODE=lora
  set_status "$BEST_RUN" eval_turing
  eval_run "$BEST_RUN" 1 || { log "post: Turing eval of $BEST_RUN did not complete; continuing to E"; post_ok=0; }
  set_status "dpo_v2_$BEST_RUN" dpo
  dpo_stage || { log "post: E incomplete; rerun the orchestrator to resume"; post_ok=0; }
  final_stage || post_ok=0
  if [ "$post_ok" = 1 ] && [ "$RUNS_OK" = 1 ] && [ "$PARTIAL" = 0 ]; then
    [ "$DRY" = 1 ] || touch "$DONE_MARK"
    set_status post done
    log "V2_ALL_DONE"
  elif [ "$post_ok" = 1 ] && [ "$RUNS_OK" = 1 ]; then
    set_status post done
    log "post stages done; partial pass (--only/--from), so $DONE_MARK is not written: a full pass writes it"
  else
    set_status post incomplete
    log "V2_INCOMPLETE: a stage above did not finish (runs ok=$RUNS_OK, post ok=$post_ok); rerun the orchestrator to resume (no $DONE_MARK written)"
  fi
}

# --------------------------------------------------------------------- main
main(){
  local started run
  cd "$AI" || { echo "cannot cd $AI"; exit 1; }
  [ "$DRY" = 1 ] || rm -f "$DONE_MARK"
  log "START orchestrate_v2 (pid $$) dry_run=$DRY only=${ONLY:-all} from=${FROM:-first} runs: $V2_RUNS; power: $(pmset -g batt | head -1)"
  set_status intake intake
  if [ -f "$AI/scripts/intake.py" ]; then
    sh_run "intake" "$ENV $PY -m scripts.intake >> $TOOLS/intake_v2.log 2>&1" || log "intake: FAILED (see $TOOLS/intake_v2.log); continuing with the sets that exist"
  else log "intake: scripts/intake.py not present; skipped"; fi
  if [ -n "$ONLY" ]; then
    if [ "$ONLY" = post ]; then post_stage; else run_one "$ONLY"; fi
  else
    started=0
    for run in $V2_RUNS; do
      if [ -n "$FROM" ] && [ "$started" = 0 ]; then
        if [ "$run" = "$FROM" ]; then started=1; else log "$run: before --from $FROM, skipped"; continue; fi
      fi
      run_one "$run"
    done
    post_stage
  fi
  log "END orchestrate_v2 (pid $$)"
}
# ORCHESTRATE_V2_LIB=1 . orchestrate_v2.sh  loads the helpers without running anything (unit tests)
[ "${ORCHESTRATE_V2_LIB:-0}" = 1 ] || main

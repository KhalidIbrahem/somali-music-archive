#!/bin/bash
# Phase 2 recipes for the qaraami-v2 runs (A-D), one bash function, bash 3.2.
#
#   source runs/_tools/recipes_v2.sh; recipe_v2 qaraami_large && echo "$MODEL r$RANK a$ALPHA lr $LR"
#
# recipe_v2 <run> sets, for the four supervised runs of the brief:
#   MODEL         facebook/musicgen-{medium,large,melody}
#   RANK ALPHA    LoRA rank / alpha on ALL attention + FFN projections
#                 (q_proj k_proj v_proj out_proj fc1 fc2, scale_train's DEFAULT_TARGETS)
#   LR            peak learning rate (cosine, 100 warm-up steps in scale_train)
#   MAX_STEPS     6000 for every run; the harness stops earlier when validation is
#                 flat for --early-stop-patience steps
#   SETS          the set names the run merges (data/sets/<set>/captions.jsonl);
#                 names whose set is not built yet are dropped by existing_sets
#   CAPTIONS      the merged run captions file build_sets --merge run_<run> writes
#   EXTRA_TRAIN   extra scale_train flags (every run: --ckpt-every 250
#                 --early-stop-patience 750 --mem-cap-gb 85; melody: the MIDI chroma dir,
#                 absolute: scale_train/scale_eval take --chroma-dir as given, not repo-relative)
#   EXTRA_EVAL    extra scale_eval flags (melody: chroma dir + reference clips)
#   RIGHTS        releasable | research_only (research_only = trained on harvard_* rows:
#                 tailnet-only service, never the public site, never published). The
#                 recipe's value; the orchestrator re-derives it from the merged captions
#                 (register_adapter's rule) and only ever tightens it to research_only.
#   FULL_DECODER  1 = full fine-tune of the decoder (no LoRA) when the probe says it
#                 fits under 60 GB, else the orchestrator falls back to LoRA RANK/ALPHA
#
#   A qaraami_medium_full  musicgen-medium  FULL decoder (fallback LoRA r64 a128)  lr 2e-5
#                          ahmed_oud sep_oud internet_oud contrib_*_oud (consented tiers only)
#   B qaraami_large        musicgen-large   LoRA r128 a256                         lr 3e-5
#                          A's sets + ahmed_mix
#   C qaraami_large_all    musicgen-large   LoRA r128 a256                         lr 3e-5
#                          B's sets + harvard_full harvard_sep_oud   (RESEARCH-ONLY)
#   D qaraami_melody       musicgen-melody  LoRA r64 a128                          lr 5e-5
#                          A's sets, conditioned on the MIDI chroma data/sets/<set>/chroma_midi
#   E dpo_names <best>     DPO_TAG DPO_NAME DPO_RUN_REL DPO_EVAL_TAG DPO_TRAIN_AB DPO_EVAL_AB for
#                          recipe E on the best of B/C (two distinct A/B directories)
#
# The orchestrator (orchestrate_v2.sh) sources this file; REPO defaults to the
# checkout under ~/Projects when the caller has not set it.
REPO=${REPO:-$HOME/Projects/somali-music-archive}
SETS_ROOT=$REPO/data/sets
V2_MAX_STEPS=6000
V2_CKPT_EVERY=250
V2_EARLY_STOP_PATIENCE=750
V2_MEM_CAP_GB=${MEM_CAP_GB:-85}
V2_COMMON_TRAIN="--ckpt-every $V2_CKPT_EVERY --early-stop-patience $V2_EARLY_STOP_PATIENCE --mem-cap-gb $V2_MEM_CAP_GB"
V2_MELODY_CHROMA=chroma_midi          # data/sets/<set>/chroma_midi/<stem>.npy, (235, 12) float16 per 30 s clip
V2_MELODY_REF_SET=ahmed_oud           # reference clips whose chroma conditions both sides of a melody A/B pair
V2_RUNS="qaraami_medium_full qaraami_large qaraami_large_all qaraami_melody"

# contrib_tier <set dir>: "consented" | "research_only" | "unbuilt" | "unknown" from the
# rights labels of a contributor set's captions (intake stamps contrib_<slug>_consented
# or contrib_<slug>_research_only on every row; build_sets carries them into the set).
# A single research_only row makes the whole set research-only.
contrib_tier(){
  local cap=$1/captions.jsonl
  [ -s "$cap" ] || { echo unbuilt; return 0; }
  if grep -q '"rights": *"contrib_[^"]*_research_only"' "$cap"; then echo research_only
  elif grep -q '"rights": *"contrib_[^"]*_consented"' "$cap"; then echo consented
  else echo unknown; fi
}

# The isolated-oud sets of the RELEASABLE runs (A, B, D): the fixed names plus every
# contributor oud set (data/sets/contrib_<slug>_oud) whose rows are consented. A set
# still being built (no captions yet) is kept so existing_sets logs it as missing; a
# research-only or unlabelled contributor set is never merged into a releasable run
# (contrib_research_sets lists them for the log). The fixed names that do not exist
# yet are kept on purpose: existing_sets filters and the orchestrator logs the gap.
oud_sets(){
  local out="ahmed_oud sep_oud internet_oud" d
  for d in "$SETS_ROOT"/contrib_*_oud; do
    [ -d "$d" ] || continue
    case "$(contrib_tier "$d")" in consented|unbuilt) out="$out $(basename "$d")" ;; esac
  done
  echo "$out"
}

# contrib_research_sets: the contributor oud sets oud_sets excluded (research_only or
# unlabelled rights), one line, for the orchestrator's log
contrib_research_sets(){
  local out="" d
  for d in "$SETS_ROOT"/contrib_*_oud; do
    [ -d "$d" ] || continue
    case "$(contrib_tier "$d")" in research_only|unknown) out="$out $(basename "$d")" ;; esac
  done
  echo "${out# }"
}

# dpo_names <best run>: the names of recipe E on <best> (runs B/C). dpo_train --tag
# DPO_TAG writes runs/dpo_<tag>/ and its own before/after listening set
# data/ab_dpo_<tag>/ (15 s, pairNNN_base = before, _adapter = after); the
# orchestrator's scale_eval of that run uses DPO_EVAL_TAG, whose data/ab_<eval tag>/
# (base model vs DPO adapter at 30 s) and eval_<eval tag>.json must never collide
# with dpo_train's set. register_adapter serves the adapter as DPO_NAME.
dpo_names(){
  DPO_TAG=v2_$1
  DPO_NAME=dpo_$DPO_TAG
  DPO_RUN_REL=runs/$DPO_NAME
  DPO_EVAL_TAG=${DPO_NAME}_vs_base
  DPO_TRAIN_AB=data/ab_dpo_$DPO_TAG
  DPO_EVAL_AB=data/ab_$DPO_EVAL_TAG
}

# existing_sets <names...>: the names whose data/sets/<set>/captions.jsonl exists (one line);
# the missing ones go to stderr, one per line, so the orchestrator can log them.
existing_sets(){
  local n have=""
  for n in "$@"; do
    if [ -s "$SETS_ROOT/$n/captions.jsonl" ]; then have="$have $n"; else echo "$n" >&2; fi
  done
  echo "${have# }"
}

# missing_sets <names...>: the names whose set is not built yet (one line, for the log)
missing_sets(){
  local n out=""
  for n in "$@"; do [ -s "$SETS_ROOT/$n/captions.jsonl" ] || out="$out $n"; done
  echo "${out# }"
}

recipe_v2(){  # sets MODEL RANK ALPHA LR MAX_STEPS SETS CAPTIONS EXTRA_TRAIN EXTRA_EVAL RIGHTS FULL_DECODER for run $1
  MODEL=""; RANK=""; ALPHA=""; LR=""; MAX_STEPS=$V2_MAX_STEPS; SETS=""; CAPTIONS=""
  EXTRA_TRAIN="$V2_COMMON_TRAIN"; EXTRA_EVAL=""; RIGHTS=releasable; FULL_DECODER=0
  local oud
  oud=$(oud_sets)
  case "$1" in
    qaraami_medium_full)
      MODEL=facebook/musicgen-medium; FULL_DECODER=1; RANK=64; ALPHA=128; LR=2e-5
      SETS="$oud" ;;
    qaraami_large)
      MODEL=facebook/musicgen-large; RANK=128; ALPHA=256; LR=3e-5
      SETS="$oud ahmed_mix" ;;
    qaraami_large_all)
      MODEL=facebook/musicgen-large; RANK=128; ALPHA=256; LR=3e-5
      SETS="$oud ahmed_mix harvard_full harvard_sep_oud"; RIGHTS=research_only ;;
    qaraami_melody)
      MODEL=facebook/musicgen-melody; RANK=64; ALPHA=128; LR=5e-5
      SETS="$oud"
      EXTRA_TRAIN="$EXTRA_TRAIN --chroma-dir $SETS_ROOT/$V2_MELODY_REF_SET/$V2_MELODY_CHROMA"
      EXTRA_EVAL="--chroma-dir $SETS_ROOT/$V2_MELODY_REF_SET/$V2_MELODY_CHROMA --melody-refs data/sets/$V2_MELODY_REF_SET/clips/test" ;;
    *) return 1 ;;
  esac
  CAPTIONS=$SETS_ROOT/run_$1_captions.jsonl
}

# is_v2_run <name>: true when recipe_v2 knows the run
is_v2_run(){ case " $V2_RUNS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

#!/bin/bash
# Stage 5: preference optimisation toward clean oud qaraami.
# Stages, each one DPO round from an SFT adapter with reward = scripts.reward_model,
# ending in the built-in eval (reward terms, MERT-FAD to real oud, held-out oud
# token CE, A/B set data/ab_dpo_<tag>/ for the blind test):
#   probe_medium  2 prompts at real settings: s/prompt and memory for the log
#   small_oud     the small oud-only adapter (closest to the real oud clips already)
#   medium        the multi-source medium adapter, 96 prompts
#   large         the multi-source large adapter, 64 prompts (sampling cost)
# Log-probs are length-normalised (all clips have the same token count, so this
# only rescales beta): beta 5 per token ~ 0.0017 on sums.
# dpo_train aborts itself above --mem-cap-gb; mem_guard.sh pauses on system pressure.
#
#   rm -f runs/_tools/ALL_DONE; nohup bash runs/_tools/mem_guard.sh > runs/_tools/mem_guard_dpo.log 2>&1 &
#   nohup bash runs/_tools/orchestrate_dpo.sh > runs/_tools/orchestrate_dpo.log 2>&1 &
set -u
cd "$HOME/Projects/somali-music-archive/apps/ai-service" || exit 1
PY=$HOME/ai/musicgen-env/bin/python
TOOLS=$HOME/Projects/somali-music-archive/runs/_tools
export HF_HUB_OFFLINE=1
rm -f "$TOOLS/DPO_ALL_DONE"

K=${K:-4}; SEC=${SEC:-15}; EPOCHS=${EPOCHS:-3}; BETA=${BETA:-5}; LR=${LR:-5e-5}
PPS=${PPS:-2}; EVAL=${EVAL:-40}; NORM=${NORM:-mean}
stamp() { date '+%F %T'; }

run_stage() {   # tag model adapter extra-args...
  local tag=$1 model=$2 adapter=$3; shift 3
  echo "[$(stamp)] === $tag: $model from $adapter ($*)"
  "$PY" -m scripts.dpo_train --model "$model" --adapter "$adapter" --tag "$tag" --reward full \
      --logp-norm "$NORM" --beta "$BETA" --lr "$LR" --pairs-per-step "$PPS" --samples-per-prompt "$K" --seconds "$SEC" "$@" \
      2>&1 | grep -v -i -E 'warn|deprecat' | tee "$TOOLS/dpo_$tag.log"
  local rc=${PIPESTATUS[0]}
  echo "[$(stamp)] === $tag exit $rc"
  return $rc
}

run_stage probe_medium facebook/musicgen-medium ../../runs/qaraami_medium_r32/ckpt_step_2750 \
    --prompts-per-round 2 --epochs 1 --eval-prompts 2 --ce-clips 4 --margin 0

run_stage small_oud facebook/musicgen-small ../../runs/oud_lora_r16_nodrop_20260809/ckpt_step_0500 \
    --prompts-per-round 96 --epochs "$EPOCHS" --eval-prompts "$EVAL"

run_stage medium facebook/musicgen-medium ../../runs/qaraami_medium_r32/ckpt_step_2750 \
    --prompts-per-round 96 --epochs "$EPOCHS" --eval-prompts "$EVAL"

run_stage large facebook/musicgen-large ../../runs/qaraami_large_r32/ckpt_step_2750 \
    --prompts-per-round 64 --epochs "$EPOCHS" --eval-prompts "$EVAL"

touch "$TOOLS/DPO_ALL_DONE" "$TOOLS/ALL_DONE"
echo "[$(stamp)] DPO_ALL_DONE"

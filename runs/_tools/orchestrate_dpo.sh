#!/bin/bash
# Stage 5: preference optimisation toward clean oud qaraami.
# One DPO round per stage from an SFT adapter, reward = scripts.reward_model (v2:
# level-normalised features), ending in the built-in eval (reward terms, MERT-FAD
# to real oud, held-out oud token CE, A/B set data/ab_dpo_<tag>/ for the blind test).
#
# Recipe after the first medium round drifted (chosen log-ratio -1.7 nats/token,
# CE +1.5, louder and hissier): lower lr, stronger KL constraint (beta 10 on
# length-normalised log-probs), a likelihood anchor on real oud clips, and a KL
# budget that stops the round when the policy's log-ratio on its own chosen
# clips falls below -0.3 nats/token. Large first (the model that matters), then
# medium again under the new recipe. The small oud round and the failed medium
# round are kept as runs/dpo_small_oud and runs/dpo_medium_v1.
#
#   rm -f runs/_tools/ALL_DONE; nohup bash runs/_tools/mem_guard.sh > runs/_tools/mem_guard_dpo.log 2>&1 &
#   nohup caffeinate -i -s bash runs/_tools/orchestrate_dpo.sh > runs/_tools/orchestrate_dpo.log 2>&1 &
set -u
cd "$HOME/Projects/somali-music-archive/apps/ai-service" || exit 1
PY=$HOME/ai/musicgen-env/bin/python
TOOLS=$HOME/Projects/somali-music-archive/runs/_tools
export HF_HUB_OFFLINE=1
rm -f "$TOOLS/DPO_ALL_DONE"

K=${K:-4}; SEC=${SEC:-15}; EPOCHS=${EPOCHS:-2}; BETA=${BETA:-10}; LR=${LR:-2e-5}
PPS=${PPS:-2}; EVAL=${EVAL:-40}; NORM=${NORM:-mean}; SFT=${SFT:-0.5}; DRIFT=${DRIFT:-0.3}
stamp() { date '+%F %T'; }

run_stage() {   # tag model adapter extra-args...
  local tag=$1 model=$2 adapter=$3; shift 3
  echo "[$(stamp)] === $tag: $model from $adapter ($*)"
  "$PY" -m scripts.dpo_train --model "$model" --adapter "$adapter" --tag "$tag" --reward full \
      --logp-norm "$NORM" --beta "$BETA" --lr "$LR" --pairs-per-step "$PPS" --samples-per-prompt "$K" --seconds "$SEC" \
      --sft-weight "$SFT" --max-drift "$DRIFT" "$@" \
      2>&1 | grep --line-buffered -v -i -E 'warn|deprecat' | tee "$TOOLS/dpo_$tag.log"
  local rc=${PIPESTATUS[0]}
  echo "[$(stamp)] === $tag exit $rc"
  return $rc
}

run_stage large facebook/musicgen-large ../../runs/qaraami_large_r32/ckpt_step_2750 \
    --prompts-per-round 64 --epochs "$EPOCHS" --eval-prompts "$EVAL"

run_stage medium facebook/musicgen-medium ../../runs/qaraami_medium_r32/ckpt_step_2750 \
    --prompts-per-round 96 --epochs "$EPOCHS" --eval-prompts "$EVAL"

touch "$TOOLS/DPO_ALL_DONE" "$TOOLS/ALL_DONE"
echo "[$(stamp)] DPO_ALL_DONE"

#!/bin/bash
# Restoration transfer test (2026-09-08): stationary spectral subtraction on every Harvard
# clip (alpha 1.5, 12 dB floor), EnCodec tokens, a 1,500-step small-model LoRA run under the
# fixed harness (identical to runs/harvard_raw), then held-out CE on restored AND raw tokens.
# Also writes an 8-pair raw-vs-restored listening set (data/ab_restore_harvard).
#   nohup caffeinate -i bash runs/_tools/stage_restore.sh > runs/_tools/stage_restore.log 2>&1 &
set -u
REPO=$HOME/Projects/somali-music-archive; PY=$HOME/ai/musicgen-env/bin/python
cd "$REPO/apps/ai-service" || exit 1
export HF_HUB_OFFLINE=1
stamp() { date '+%F %T'; }

echo "[$(stamp)] restore all clips"
"$PY" -m scripts.restore_clips --all --workers 6 --alpha 1.5 --max-atten-db 12 2>&1 | grep -v -i warn
echo "[$(stamp)] restore exit ${PIPESTATUS[0]}"

echo "[$(stamp)] listening set raw vs restored"
"$PY" - <<'EOF'
import json, shutil
from pathlib import Path
from scripts.reward_model import hiss_terms, load_mono
REPO = Path.home() / "Projects/somali-music-archive"
rows = sorted((json.loads(l) for l in (REPO / "data/captions.jsonl").open() if '"split": "test"' in l), key=lambda r: r["clip_path"])
picked = rows[:: max(1, len(rows) // 8)][:8]
out = REPO / "data/ab_restore_harvard"; out.mkdir(exist_ok=True)
pairs = []
for i, r in enumerate(picked):
    raw = REPO / r["clip_path"]; res = REPO / "data/clips_restored" / Path(r["clip_path"]).relative_to("data/clips")
    shutil.copy2(raw, out / f"pair{i:03d}_base.wav"); shutil.copy2(res, out / f"pair{i:03d}_adapter.wav")
    t = {}
    for side, p in (("base", raw), ("adapter", res)):
        a, sr = load_mono(p, normalised=False); h = hiss_terms(a, sr)
        t[side] = {"scored": False, "pcs": None, "voiced_fraction": None, "band_snr_db": h["band_snr_db"], "rolloff95_hz": h["rolloff95_hz"]}
    pairs.append({"pair": i, "caption": r["caption"], **t})
(out / "CAPTIONS.txt").write_text("".join(f"pair{p['pair']:03d}: {p['caption']}\n" for p in pairs))
(out / "README.txt").write_text("pairNNN_base = raw Harvard clip (real cassette audio, research context only), pairNNN_adapter = the same clip after stationary spectral subtraction (alpha 1.5, 12 dB floor).\n")
(out / "ab_scores.json").write_text(json.dumps({"note": "Raw cassette clip vs spectral-subtraction restoration of the same clip; 8 stride-sampled test clips.", "pairs": pairs}, indent=1))
print("listening set:", out)
EOF

echo "[$(stamp)] tokens"
"$PY" -m scripts.phase1_tokens --captions "$REPO/data/captions_restored.jsonl" --tokens-dir "$REPO/data/tokens_restored" 2>&1 | grep -v -i warn | tail -5
echo "[$(stamp)] tokens exit ${PIPESTATUS[0]}"

echo "[$(stamp)] train harvard_restored (1500 steps, fixed harness, same recipe as harvard_raw)"
"$PY" -u "$REPO/runs/_tools/train_run.py" --run-id harvard_restored --lr 1e-4 --total-steps 1500 \
    --captions "$REPO/data/captions_restored.jsonl" --tokens-dir "$REPO/data/tokens_restored" 2>&1 | grep -v -i warn | grep -E 'step (1|[0-9]*00)/|\[ckpt|\[val|DONE|Error|Traceback|sample'
echo "[$(stamp)] train exit ${PIPESTATUS[0]}"

echo "[$(stamp)] eval"
"$PY" -u "$REPO/runs/_tools/eval_restored_ce.py" 2>&1 | grep -v -i warn
echo "[$(stamp)] RESTORE_STAGE_DONE"

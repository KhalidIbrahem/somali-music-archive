"""Write docs/eval/QORMADA_EVAL.md and the summary JSON from eval_qormada.py results.

Every number in the page comes from the result files; nothing is typed by hand.

    python apps/ai-service/scripts/qormada_eval_report.py \
        --vocadito data/eval_qormada/RESULT_vocadito.json --synth data/eval_qormada/RESULT_synth.json \
        --out docs/eval/QORMADA_EVAL.md --summary docs/eval/qormada_eval_summary.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

NEW, OLD, NONE = "qormada_v2", "release_2026_10_29", "no_melody_mode"


def paired(a: list[dict], b: list[dict], key: str, n_boot: int = 10_000) -> dict[str, float]:
    da = {r["track"]: r[key] for r in a}
    d = np.array([da[r["track"]] - r[key] for r in b])
    rng = np.random.default_rng(0)
    boots = rng.choice(d, size=(n_boot, len(d)), replace=True).mean(axis=1)
    return {
        "delta": float(d.mean()),
        "ci_low": float(np.percentile(boots, 2.5)),
        "ci_high": float(np.percentile(boots, 97.5)),
        "better": int((d > 1e-9).sum()),
        "worse": int((d < -1e-9).sum()),
        "n": len(d),
    }


def f(s: dict, k: str) -> str:
    return f"{s[k]['mean']:.3f} [{s[k]['ci_low']:.3f}, {s[k]['ci_high']:.3f}]"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vocadito", type=Path, required=True)
    ap.add_argument("--synth", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--summary", type=Path, required=True)
    args = ap.parse_args()
    voc = json.load(open(args.vocadito))["systems"]
    syn = json.load(open(args.synth))["systems"]

    d_voc = paired(voc[NEW]["per_track"], voc[OLD]["per_track"], "conp_f")
    d_voc_rpa = paired(voc[NEW]["per_track"], voc[OLD]["per_track"], "rpa")
    d_syn = paired(syn[NEW]["per_track"], syn[OLD]["per_track"], "conp_f")
    d_mm = paired(syn[NEW]["per_track"], syn[NONE]["per_track"], "conp_f")
    human = voc["human_A2_vs_A1"]["summary"]["conp_f"]["mean"]
    share = voc[NEW]["summary"]["conp_f"]["mean"] / human
    rt = float(np.mean([r["rt_factor"] for r in voc[NEW]["per_track"] + syn[NEW]["per_track"]]))

    summary = {
        "vocadito": {k: voc[k]["summary"] for k in voc},
        "synth": {k: syn[k]["summary"] for k in syn},
        "paired": {"vocadito_conp_f_new_vs_release": d_voc, "vocadito_rpa_new_vs_release": d_voc_rpa,
                   "synth_conp_f_new_vs_release": d_syn, "synth_conp_f_new_vs_no_melody_mode": d_mm},
        "share_of_human_agreement": share,
        "analysis_seconds_per_audio_second": rt,
    }
    args.summary.write_text(json.dumps(summary, indent=1))

    S = syn[NEW]["summary"]
    lo_old = voc[OLD]["summary"]["by_voice"]["low_lt_midi55"]["rpa"]["mean"]
    lo_none = voc[NONE]["summary"]["by_voice"]["low_lt_midi55"]["rpa"]["mean"]
    lines = [
        "# Qormada transcription accuracy",
        "",
        "Measured 2026-10-31 on the code `/transcribe` runs in the browser (`apps/web/lib/qormada`),",
        "driven from the command line by `apps/web/scripts/qormada-eval/transcribe.ts` and scored with",
        "mir_eval by `apps/ai-service/scripts/eval_qormada.py`. This page is written by",
        "`apps/ai-service/scripts/qormada_eval_report.py` from the result files; no number is typed by hand.",
        "Means over tracks with bootstrap 95 % CIs (10,000 resamples, seed 0).",
        "",
        "Metrics: **note F1 (COnP)**, a note counts when its onset is within 50 ms and its pitch within",
        "50 cents of an annotated note; **COnPOff** also needs the offset; **RPA** is the share of voiced",
        "reference frames whose pitch is within 50 cents.",
        "",
        "## 1. Real singers: vocadito (40 recordings, 29 singers, 7 languages, two annotators)",
        "",
        "Bittner et al. 2021, arXiv:2110.05580, CC BY 4.0. Solo voice. The two annotators scored against",
        "each other give the human agreement ceiling; systems are scored against each annotator and averaged.",
        "",
        "| system | note F1 (COnP) | COnPOff F1 | onset F1 | RPA | low voices (n = 14) note F1 / RPA |",
        "| --- | --- | --- | --- | --- | --- |",
        f"| two human annotators | {f(voc['human_A2_vs_A1']['summary'], 'conp_f')} | {f(voc['human_A2_vs_A1']['summary'], 'conpoff_f')} | {f(voc['human_A2_vs_A1']['summary'], 'onset_f')} | | |",
    ]
    for k, label in [(NEW, "**Qormada v2 (this page)**"), (OLD, "release 2026-10-29 (always high-passed)"), (NONE, "no melody mode (Pitch tab)")]:
        s = voc[k]["summary"]
        lo = s["by_voice"]["low_lt_midi55"]
        lines.append(f"| {label} | {f(s, 'conp_f')} | {f(s, 'conpoff_f')} | {f(s, 'onset_f')} | {f(s, 'rpa')} | {lo['conp_f']['mean']:.3f} / {lo['rpa']['mean']:.3f} |")
    lines += [
        "",
        f"Qormada v2 reaches **{share:.0%} of the agreement between two human annotators** (note F1).",
        f"Against the 2026-10-29 release, paired over the 40 tracks: note F1 {d_voc['delta']:+.3f}",
        f"[{d_voc['ci_low']:+.3f}, {d_voc['ci_high']:+.3f}] ({d_voc['better']} tracks better, {d_voc['worse']} worse),",
        f"RPA {d_voc_rpa['delta']:+.3f} [{d_voc_rpa['ci_low']:+.3f}, {d_voc_rpa['ci_high']:+.3f}].",
        "",
        "## 2. Somali-style synthetic set (24 melodies x 5 conditions = 120 files, exact ground truth)",
        "",
        "`apps/ai-service/scripts/synth_somali_bench.py`, seed 2026. Each melody uses one of the five rotations",
        "of the anhemitonic pentatonic set (the qaraami/heello scale family), a global tuning offset drawn from",
        "±40 cents of A440 and a per-note deviation (sd 12 cents), played as a plucked string (oud register) or a",
        "voice-like tone (low or high register), 70–140 BPM. Conditions: clean; + bass line (3 dB under the melody);",
        "+ bass and drums; + noise at 20 dB SNR; full mix (bass, drums, reverb, noise). All audio is synthesised.",
        "The extra columns are what a Somali-music transcriber has to get right: the recording's tuning offset,",
        "the scale, and each note's own deviation in cents.",
        "",
        "| system | note F1 (COnP) | RPA | tuning offset error (cents) | scale identified | median note cents error |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for k, label in [(NEW, "**Qormada v2**"), (OLD, "release 2026-10-29"), (NONE, "no melody mode")]:
        s = syn[k]["summary"]
        lines.append(f"| {label} | {f(s, 'conp_f')} | {f(s, 'rpa')} | {f(s, 'offset_err_c')} | {s['scale_correct']['mean']:.1%} | {s['note_cents_err_median']:.1f} |")
    lines += ["", "By condition and register (Qormada v2 / no melody mode, note F1):", "", "| group | n | Qormada v2 | no melody mode | scale identified (v2) |", "| --- | --- | --- | --- | --- |"]
    for g, d in S["by_voice"].items():
        o = syn[NONE]["summary"]["by_voice"][g]
        lines.append(f"| {g.replace('cond_', 'condition: ').replace('reg_', 'register: ')} | {d['n']} | {d['conp_f']['mean']:.3f} | {o['conp_f']['mean']:.3f} | {d['scale_correct']['mean']:.1%} |")
    lines += [
        "",
        f"Melody mode against none, paired over 120 files: note F1 {d_mm['delta']:+.3f} [{d_mm['ci_low']:+.3f}, {d_mm['ci_high']:+.3f}].",
        f"v2 against the release: {d_syn['delta']:+.3f} [{d_syn['ci_low']:+.3f}, {d_syn['ci_high']:+.3f}] (unchanged on mixes by design).",
        "",
        "## What changed in v2, and how it was chosen",
        "",
        "The release always high-passed the audio at 150 Hz and tracked from 100 Hz, which keeps the tracker off",
        f"a bass line but cuts a low singer's fundamental (vocadito low voices: RPA {lo_old:.2f} against {lo_none:.2f} without it).",
        "v2 tracks both the high-passed and the direct signal and keeps the direct track only when the two agree",
        "(at least 90 % of frames voiced in both within 50 cents) and the direct track hears at least as many",
        "voiced frames. Lower fixed cut-offs (high-pass / pitch floor 120/85, 100/75 and 90/65 Hz; results in",
        "`data/eval_qormada/sweep/`) were tried first and lost more on mixes than they gained on solo voices.",
        "The rule and its two thresholds",
        "were chosen after looking at both sets, so the vocadito gain is not a held-out result; a new annotated",
        "set is the honest test.",
        "",
        "## Speed",
        "",
        f"{rt * 1000:.0f} ms of analysis per second of audio (Node on this Mac; both tracks), so a 3-minute song",
        "takes a few seconds. Browser timing on a phone is not measured here.",
        "",
        "## Limits",
        "",
        "- vocadito is solo voice; it says nothing about instruments or mixes. The synthetic set does, but",
        "  synthetic plucks and voices are cleaner than real recordings, so its numbers are an upper bound.",
        "- No annotated Somali recording exists yet. The five packs in `data/annotation/` are ready for a",
        "  musician to correct; that is the next and most important test.",
        "- Offsets are hard for every transcriber (COnPOff); sheet-music use depends mostly on onsets and pitch.",
        "- n = 40 and n = 120; CIs are over tracks, not over singers.",
        "",
    ]
    args.out.write_text("\n".join(lines))
    print(f"wrote {args.out} and {args.summary}")


if __name__ == "__main__":
    main()

"""Analyse the /study blind listening study and write docs/eval/LISTENING_STUDY.md.

Responses come from the Upstash list the site writes to (KV_REST_API_URL /
KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in the
environment), or from a JSON-lines file (the dev server's
apps/web/.study-responses.local.jsonl, or downloaded answers). Clip ids are
mapped to conditions with apps/ai-service/study/key.json.

Per comparison: how often the adapter side was chosen as more Somali, the base
side, "about the same" and "neither sounds Somali"; the adapter's share of the
decisive answers with a 95 % CI bootstrapped over listeners (answers from one
person are not independent) and an exact two-sided sign test; the same for
recording quality; and the split by listener background.

Exclusions, applied before anything is counted: a listener who picked A or B
for the attention check (one clip against itself), and answers where either
clip was played for less than 3 s.

    python apps/ai-service/scripts/study_analyze.py --redis --out docs/eval/LISTENING_STUDY.md
    python apps/ai-service/scripts/study_analyze.py --file apps/web/.study-responses.local.jsonl --out /tmp/x.md
"""

from __future__ import annotations

import argparse
import json
import math
import os
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

LIST_KEY = "study:qaraamigen-listening-v1:responses"
KEY = Path(__file__).resolve().parents[1] / "study" / "key.json"
MIN_PLAYED = 3.0
LABELS = {
    "oud": "Solo oud, MusicGen small: base vs `oud` adapter",
    "cleanoud": "Solo oud, ACE-Step 1.5: base vs `ace_clean_oud` adapter",
    "songs": "Songs with Somali lyrics, ACE-Step 1.5: base vs `ace_songs_v4` adapter",
}
GROUPS = {
    "Somali performers": {"somali_performer_pro", "somali_performer"},
    "Somali listeners": {"somali_listener"},
    "Other musicians and other": {"other_musician", "other"},
}


def from_redis() -> list[dict]:
    url = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    if not url or not token:
        raise SystemExit("set KV_REST_API_URL and KV_REST_API_TOKEN (Vercel → Storage → the store → .env.local)")
    req = urllib.request.Request(
        url.rstrip("/"), data=json.dumps(["LRANGE", LIST_KEY, "0", "-1"]).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    rows = json.load(urllib.request.urlopen(req, timeout=30))["result"]
    return [json.loads(r) for r in rows]


def from_file(path: Path) -> list[dict]:
    out = []
    for line in path.read_text().splitlines():
        if line.strip():
            obj = json.loads(line)
            out.append(obj if "response" in obj else {"receivedAt": None, "response": obj})
    return out


def sign_test(k: int, n: int) -> float:
    """Exact two-sided binomial test of k successes in n against 1/2."""
    if n == 0:
        return float("nan")
    tail = sum(math.comb(n, i) for i in range(0, min(k, n - k) + 1)) / 2**n
    return min(1.0, 2 * tail)


def side(ans: dict, choice: str, key: dict) -> str:
    """Map an answer (a / b / same / neither) to adapter / base / same / neither."""
    if choice in ("same", "neither"):
        return choice
    clip = ans["a"] if choice == "a" else ans["b"]
    return key[clip]["condition"]


def listener_boot(per_listener: dict[str, list[str]], n_boot: int = 10_000) -> tuple[float, float]:
    """95 % CI of the adapter share of decisive answers, resampling listeners."""
    rows = [(v.count("adapter"), v.count("adapter") + v.count("base")) for v in per_listener.values()]
    rows = [r for r in rows if r[1] > 0]
    if len(rows) < 2:
        return float("nan"), float("nan")
    arr = np.array(rows, dtype=float)
    rng = np.random.default_rng(0)
    idx = rng.integers(0, len(arr), size=(n_boot, len(arr)))
    k = arr[idx, 0].sum(axis=1)
    n = arr[idx, 1].sum(axis=1)
    share = k / np.maximum(n, 1)
    return float(np.percentile(share, 2.5)), float(np.percentile(share, 97.5))


def summarise(answers: list[tuple[str, dict]], key: dict, field: str) -> dict:
    counts = Counter()
    per_listener: dict[str, list[str]] = defaultdict(list)
    for session, a in answers:
        s = side(a, a[field], key)
        counts[s] += 1
        per_listener[session].append(s)
    k, n = counts["adapter"], counts["adapter"] + counts["base"]
    lo, hi = listener_boot(per_listener)
    return {
        "answers": sum(counts.values()), "listeners": len(per_listener),
        "adapter": counts["adapter"], "base": counts["base"], "same": counts["same"], "neither": counts["neither"],
        "adapter_share": k / n if n else float("nan"), "ci_low": lo, "ci_high": hi, "sign_p": sign_test(k, n),
    }


def fmt(s: dict, with_neither: bool) -> str:
    share = "n/a" if math.isnan(s["adapter_share"]) else f"{s['adapter_share']:.0%}"
    ci = "" if math.isnan(s["ci_low"]) else f" [{s['ci_low']:.0%}, {s['ci_high']:.0%}]"
    p = "n/a" if math.isnan(s["sign_p"]) else f"{s['sign_p']:.3f}"
    neither = f" | {s['neither']}" if with_neither else ""
    return f"| {s['listeners']} | {s['answers']} | {s['adapter']} | {s['base']} | {s['same']}{neither} | {share}{ci} | {p} |"


def main() -> None:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--redis", action="store_true")
    src.add_argument("--file", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--exclude", nargs="*", default=[], help="session ids to drop (e.g. test runs)")
    args = ap.parse_args()

    key = json.loads(KEY.read_text())
    records = from_redis() if args.redis else from_file(args.file)
    responses = [r["response"] for r in records if r["response"]["session"] not in set(args.exclude)]
    # One response per session (a resend after a failure keeps the last).
    responses = list({r["session"]: r for r in responses}.values())

    kept, failed_attention, short = [], 0, 0
    profiles = {}
    for r in responses:
        if any(a["attention"] and a["somali"] in ("a", "b") for a in r["answers"]):
            failed_attention += 1
            continue
        profiles[r["session"]] = r
        for a in r["answers"]:
            if a["attention"]:
                continue
            if a["playedA"] < MIN_PLAYED or a["playedB"] < MIN_PLAYED:
                short += 1
                continue
            kept.append((r["session"], a))

    lines = [
        "# Listening study: does it sound Somali?",
        "",
        "Blind paired comparison run on the public site (`/study`), written by",
        "`apps/ai-service/scripts/study_analyze.py`; no number is typed by hand. Each listener hears four",
        "pairs from every comparison plus one attention check (a clip against itself), sides randomised,",
        "clips loudness-matched at -16 LUFS and named opaquely. Question 1: which sounds more like Somali",
        "music (A / B / about the same / neither sounds Somali). Question 2: which sounds better as a recording.",
        "",
        f"Responses: {len(responses)}; excluded for the attention check: {failed_attention}; listeners kept: {len(profiles)};",
        f"answers dropped because a clip played under {MIN_PLAYED:.0f} s: {short}; answers analysed: {len(kept)}.",
        "",
        "Listener backgrounds: " + ", ".join(f"{k} {v}" for k, v in Counter(p["background"] for p in profiles.values()).most_common()) + ".",
        "Playback: " + ", ".join(f"{k} {v}" for k, v in Counter(p["playback"] for p in profiles.values()).most_common()) + ".",
        "",
        "Adapter share = adapter / (adapter + base); CI = 95 % bootstrap over listeners (10,000 resamples);",
        "p = exact two-sided sign test on the decisive answers. With few listeners, read the counts, not the p.",
        "",
    ]
    summary: dict = {"responses": len(responses), "excluded_attention": failed_attention, "listeners": len(profiles), "answers": len(kept), "comparisons": {}}
    for comp, label in LABELS.items():
        rows = [(s, a) for s, a in kept if a["comparison"] == comp]
        som = summarise(rows, key, "somali")
        qual = summarise(rows, key, "quality")
        summary["comparisons"][comp] = {"somali": som, "quality": qual, "groups": {}}
        lines += [
            f"## {label}",
            "",
            "**More like Somali music**",
            "",
            "| listeners | answers | adapter | base | same | neither | adapter share [95 % CI] | sign-test p |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            fmt(som, True),
            "",
            "**Better as a recording**",
            "",
            "| listeners | answers | adapter | base | same | adapter share [95 % CI] | sign-test p |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            fmt(qual, False),
            "",
            "By listener background (more like Somali music):",
            "",
            "| group | listeners | answers | adapter | base | same | neither | adapter share [95 % CI] | sign-test p |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for g, members in GROUPS.items():
            sub = [(s, a) for s, a in rows if profiles[s]["background"] in members]
            gs = summarise(sub, key, "somali")
            summary["comparisons"][comp]["groups"][g] = gs
            lines.append(f"| {g} " + fmt(gs, True))
        lines.append("")
    comments = [p["comment"] for p in profiles.values() if p.get("comment")]
    lines += [f"## Comments ({len(comments)})", "", "Kept in the result JSON, not printed here (participants' own words).", ""]
    args.out.write_text("\n".join(lines))
    args.out.with_suffix(".json").write_text(json.dumps({**summary, "comments": comments}, indent=1, ensure_ascii=False))
    print(f"wrote {args.out}: {len(profiles)} listeners, {len(kept)} answers")


if __name__ == "__main__":
    main()

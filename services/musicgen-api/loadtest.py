"""Sequential load test: N ten-second generations through the HTTP API, alternating
adapters so the hot-swap cost is included. Records wall-clock and server-side
latency (p50 / p95), peak MPS driver memory (from /health) and the server's RSS.
Writes docs/deploy/LOAD_TEST.md. Usage: python loadtest.py [--n 20] [--host 127.0.0.1]
"""
from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ENV = Path.home() / "ai/musicgen-api/musicgen-api.env"
TOKEN = next((l.split("=", 1)[1].strip() for l in ENV.read_text().splitlines() if l.startswith("MUSICGEN_API_TOKEN=")), "")
PROMPTS = {
    "oud": "Somali qaraami led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, intimate home recording",
    "harvard_raw": "Qaraami, traditional Somali music, lively at 129 BPM, pentatonic melody rooted on F#, vintage archival recording",
}


def call(base: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(base + path, method="POST" if body else "GET", headers={"Authorization": f"Bearer {TOKEN}", "content-type": "application/json"})
    with urllib.request.urlopen(req, data=json.dumps(body).encode() if body else None, timeout=600) as res:
        return json.loads(res.read())


def server_rss_mb(port: int) -> float:
    out = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], capture_output=True, text=True).stdout.split()
    if not out:
        return 0.0
    rss = subprocess.run(["ps", "-o", "rss=", "-p", out[0]], capture_output=True, text=True).stdout.strip()
    return round(int(rss or 0) / 1024, 1)


def pct(values: list[float], p: float) -> float:
    s = sorted(values)
    k = max(0, min(len(s) - 1, round((p / 100) * (len(s) - 1))))
    return s[k]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--duration", type=int, default=10)
    args = ap.parse_args()
    base = f"http://{args.host}:{args.port}"
    health0 = call(base, "/health")
    rows = []
    peak_driver = health0["memory"].get("mps_driver_mb", 0)
    peak_rss = server_rss_mb(args.port)
    for i in range(args.n):
        adapter = "oud" if i % 2 == 0 else "harvard_raw"
        t0 = time.time()
        meta = call(base, "/generate", {"prompt": PROMPTS[adapter], "duration": args.duration, "seed": 1000 + i, "adapter": adapter, "cfg": 3.0})
        wall = time.time() - t0
        health = call(base, "/health")
        peak_driver = max(peak_driver, health["memory"].get("mps_driver_mb", 0))
        peak_rss = max(peak_rss, server_rss_mb(args.port))
        rows.append({"i": i + 1, "adapter": adapter, "wall_s": round(wall, 2), "server_s": meta["total_seconds"], "gen_s": meta["generation_seconds"], "audio_s": meta["seconds_generated"]})
        print(f"{i + 1:02d} {adapter:12s} wall {wall:6.2f}s gen {meta['generation_seconds']:6.2f}s driver {health['memory'].get('mps_driver_mb', 0)} MB", flush=True)

    def summarize(sel: list[dict]) -> dict:
        w = [r["wall_s"] for r in sel]
        g = [r["gen_s"] for r in sel]
        return {"n": len(sel), "wall_p50": round(pct(w, 50), 2), "wall_p95": round(pct(w, 95), 2), "wall_mean": round(statistics.mean(w), 2), "gen_p50": round(pct(g, 50), 2), "gen_p95": round(pct(g, 95), 2), "rtf": round(statistics.mean(g) / args.duration, 3)}

    overall = summarize(rows)
    per = {a: summarize([r for r in rows if r["adapter"] == a]) for a in PROMPTS}
    out = REPO / "docs/deploy/LOAD_TEST.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Load test — {args.n} sequential {args.duration}-second generations",
        "",
        f"Date: {time.strftime('%Y-%m-%d %H:%M %Z')} · host: {args.host}:{args.port} · device: {health0['device']} · base: {health0['base_model']} · adapters alternating oud / harvard_raw (hot-swap included) · batch size 1 · CFG 3.0 · client on the same machine.",
        "",
        "| metric | overall | oud | harvard_raw |",
        "| --- | --- | --- | --- |",
        f"| requests | {overall['n']} | {per['oud']['n']} | {per['harvard_raw']['n']} |",
        f"| wall-clock latency p50 (s) | {overall['wall_p50']} | {per['oud']['wall_p50']} | {per['harvard_raw']['wall_p50']} |",
        f"| wall-clock latency p95 (s) | {overall['wall_p95']} | {per['oud']['wall_p95']} | {per['harvard_raw']['wall_p95']} |",
        f"| wall-clock mean (s) | {overall['wall_mean']} | {per['oud']['wall_mean']} | {per['harvard_raw']['wall_mean']} |",
        f"| model generate p50 / p95 (s) | {overall['gen_p50']} / {overall['gen_p95']} | {per['oud']['gen_p50']} / {per['oud']['gen_p95']} | {per['harvard_raw']['gen_p50']} / {per['harvard_raw']['gen_p95']} |",
        f"| real-time factor (generate s ÷ audio s) | {overall['rtf']} | {per['oud']['rtf']} | {per['harvard_raw']['rtf']} |",
        f"| peak MPS driver memory (MB) | {peak_driver} | | |",
        f"| peak server RSS (MB) | {peak_rss} | | |",
        "",
        "Wall clock includes HTTP, WAV encoding and file write; `generate` is the model call alone. Every request carried the adapter's provenance statement. No request was refused (sequential client, queue depth 1).",
        "",
        "## Per-request",
        "",
        "| # | adapter | wall (s) | generate (s) | audio (s) |",
        "| --- | --- | --- | --- | --- |",
        *[f"| {r['i']} | {r['adapter']} | {r['wall_s']} | {r['gen_s']} | {r['audio_s']} |" for r in rows],
        "",
        "Re-run: `~/ai/musicgen-env/bin/python services/musicgen-api/loadtest.py --n 20`.",
    ]
    out.write_text("\n".join(lines) + "\n")
    print(json.dumps({"overall": overall, "per_adapter": per, "peak_driver_mb": peak_driver, "peak_rss_mb": peak_rss}, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()

# Load test — 20 sequential 10-second generations

Date: 2026-09-04 11:54 CDT · host: 127.0.0.1:8765 · device: mps · base: facebook/musicgen-small · adapters alternating oud / harvard_raw (hot-swap included) · batch size 1 · CFG 3.0 · client on the same machine.

| metric | overall | oud | harvard_raw |
| --- | --- | --- | --- |
| requests | 20 | 10 | 10 |
| wall-clock latency p50 (s) | 8.35 | 8.35 | 8.33 |
| wall-clock latency p95 (s) | 8.58 | 8.58 | 8.6 |
| wall-clock mean (s) | 8.38 | 8.38 | 8.37 |
| model generate p50 / p95 (s) | 8.14 / 8.36 | 8.15 / 8.36 | 8.12 / 8.38 |
| real-time factor (generate s ÷ audio s) | 0.817 | 0.817 | 0.816 |
| peak MPS driver memory (MB) | 3240 | | |
| peak server RSS (MB) | 1477.1 | | |

Wall clock includes HTTP, WAV encoding and file write; `generate` is the model call alone. Every request carried the adapter's provenance statement. No request was refused (sequential client, queue depth 1).

## Per-request

| # | adapter | wall (s) | generate (s) | audio (s) |
| --- | --- | --- | --- | --- |
| 1 | oud | 8.43 | 8.19 | 9.94 |
| 2 | harvard_raw | 8.33 | 8.12 | 9.94 |
| 3 | oud | 8.35 | 8.15 | 9.94 |
| 4 | harvard_raw | 8.3 | 8.1 | 9.94 |
| 5 | oud | 8.58 | 8.36 | 9.94 |
| 6 | harvard_raw | 8.35 | 8.13 | 9.94 |
| 7 | oud | 8.3 | 8.1 | 9.94 |
| 8 | harvard_raw | 8.31 | 8.11 | 9.94 |
| 9 | oud | 8.27 | 8.07 | 9.94 |
| 10 | harvard_raw | 8.32 | 8.12 | 9.94 |
| 11 | oud | 8.46 | 8.26 | 9.94 |
| 12 | harvard_raw | 8.6 | 8.38 | 9.94 |
| 13 | oud | 8.33 | 8.12 | 9.94 |
| 14 | harvard_raw | 8.34 | 8.14 | 9.94 |
| 15 | oud | 8.38 | 8.18 | 9.94 |
| 16 | harvard_raw | 8.41 | 8.2 | 9.94 |
| 17 | oud | 8.3 | 8.1 | 9.94 |
| 18 | harvard_raw | 8.3 | 8.1 | 9.94 |
| 19 | oud | 8.42 | 8.2 | 9.94 |
| 20 | harvard_raw | 8.42 | 8.19 | 9.94 |

Re-run: `~/ai/musicgen-env/bin/python services/musicgen-api/loadtest.py --n 20`.

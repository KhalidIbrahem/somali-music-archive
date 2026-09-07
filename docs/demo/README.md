# Demo page

`site/index.html` is the shareable research demo: prose, tables, figures and
inline base-vs-adapter audio on identical prompts and seeds, in the format of a
research group's demo index. It is generated, not written by hand:

    ~/ai/musicgen-env/bin/python apps/ai-service/scripts/build_demo_page.py

which reads `runs/qaraami_*_r32/eval_*.json`, the run configs and loss logs,
`data/eval_pcs/*.csv`, `data/ab_*/`, `data/*_ab_listening/` and
`data/ab_melody/`, transcodes the selected clips to 96 kb/s MP3 under
`site/audio/`, draws `docs/figures/ft7_scale_val_curves`, and writes two
outputs:

- `site/index.html` (tracked) with relative links into `site/audio/` and
  `site/figures/` (both ignored, regenerable);
- `site/QaraamiGen-demo.html` (ignored, ~12 MB), the same page with every
  clip and figure inlined as data URIs. This single file is what gets sent.

Clip selection is by rule, listed in the script docstring, not by ear. The
page contains model output only; no source recording, and no adapter weights.
Rights status per collection: `docs/DATA_PROVENANCE.md`.

`DEMO_SCRIPT.md` is the separate screen-recording script for the live
base-vs-adapter service (`services/musicgen-api`, `/demo`).

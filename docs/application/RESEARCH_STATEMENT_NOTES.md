# Research statement — fact sheet (bullets only, 2026-09-04)

Three tracks, one system. Every bullet is something the repo can back with a
file or a number; nothing here is aspiration dressed as result.

## Track 1 — Musicology: measuring an oral tradition's tonal system

**Discovered**
- Somali song is predominantly anhemitonic-pentatonic in practice, not only in
  description: 86 % of voiced frames sit within a quarter tone of a per-track
  fitted pentatonic grid (dev subset, 105 tracks, 706,483 gated frames; paper §5.3).
- Against a fixed A440/12-TET grid the same frames smear to a 63-cent
  dispersion; per-track grid alignment concentrates it to a median 26 cents.
  The cassette channel (speed, transfer) is the confound, and it is removable
  by measurement design rather than by "cleaning".
- Pre-registered diachronic test on date-stamped tracks 1964–1976: no
  detectable drift toward equal temperament (median dispersion 25.7 vs 26.8 c,
  Mann–Whitney p = 0.47, n = 13 + 6 — preliminary).
- Western key correction on this repertoire rewrites 77 % of detected notes and
  lowers pentatonic conformity (0.898 → 0.862); a scale-aware quantiser
  preserves the 11 % of notes carrying ornament/microtonal inflection (§7.6).

**Built**
- The PCS/pentatonic scorer (`scripts/pcs.py`, `scripts/pentatonic.py`):
  torchcrepe f0 → tuning-offset fit → 5-rotation pentatonic correlator →
  per-frame cents distance; dependency-light, unit-tested; exposed as `/pcs`
  in the local API.
- The intonation pipeline behind the paper's §§5–6 (`analyze_corpus.py`).

**Measured** — the numbers above, plus: real held-out clips score PCS
0.847 (Harvard, n = 1,076) and 0.914 (oud, n = 164) with voiced fractions 0.53 / 0.44
and median tape tuning offsets of 26 / 3.6 cents.

**Remains** — expert annotation with Somali musicians (genre labels,
intonation audit); stem-separated per-degree tuning profiles; full 605-track
processing; consented field recordings with living masters as calibration.

## Track 2 — AI: can a generative model learn the tradition, and how do you know?

**Discovered**
- A harness defect masqueraded as a scientific negative for six weeks. HF
  MusicGen's decoder applies dropout *functionally* via 37 float attributes
  consumed by `F.dropout(..., training=self.training)`; module-level sweeps
  miss them. On identical zero-init LoRA weights: eval-mode CE 4.05, train-mode
  9.74 — worse than uniform random (7.62). Optimisation fitted a forward path
  evaluation never saw; held-out loss rose from 4.6 to 6.7–7.2 at every
  learning rate. Diagnosed with a five-condition probe
  (`probe_train_eval_gap.py`, re-run 2026-09-04, `docs/figures/ft2`).
- With train ≡ eval restored, LoRA r = 16 on musicgen-small beats the base
  model on unseen songs for both corpora: oud val 4.5132 → 4.4785, test
  2.6302 → 2.6092; Harvard raw val 4.6262 → 4.5501, test 4.8363 → 4.7468.
  Every checkpoint beats base. Margins are small (0.5–3 %); the effect is real
  and reproducible, not large.
- The adapters change *how much melody* the model produces: voiced fraction
  +64 % (oud) and +68 % (Harvard) over base, above the real clips' level, and
  they learn the cassettes' ~25-cent tuning offset (base sits near 5 c).
  Pentatonic conformity stays similar (oud) or falls (Harvard: 0.87 → 0.71).
  PCS at n = 8 moves by a few hundredths between torch builds (one clip's
  tuning-offset flip) — it is a direction, not a statistic.
- Denoising the corpus with a speech enhancer (DeepFilterNet, the pipeline's
  own `clean` stage) is a trap: it removes ≈15 dB, mostly 1–3 kHz (the oud's
  band), leaves a signal correlating 0.41 with the raw waveform, and the
  adapter trained on it is *worse than base* on raw audio (4.8705 vs 4.8363).
- Training plateaus by ~2,500 steps at lr 1e-4 (val Δ per 250 steps 0.0065 →
  0.0005); 3,000 steps bought 0.012 test CE over 1,500.
- Broken-harness generations score 0.98 PCS on half the melody (voiced 0.20):
  conformity of silence. This is why PCS is never reported alone.

**Built**
- The fixed LoRA harness over precomputed EnCodec tokens with delay-pattern
  labels (`phase2_train.py`), run tooling (`runs/_tools`), the evaluation
  generator (`eval_report.py`), a reproducibility check
  (`scripts/reproduce_oud_smoke.sh`).
- A local inference service (`services/musicgen-api`): musicgen-small on
  Apple silicon, two adapters hot-swapped per request, batch size 1, 3-request
  queue, bearer auth, PCS endpoint, provenance line on every output; 10 s of
  audio in 8.35 s p50 / 8.58 s p95, 3.2 GB peak GPU memory; launchd-managed;
  reachable only on loopback and a Tailscale address.
- Two model cards; A/B listening sets for both corpora (8 pairs each, same
  seed both sides).

**Measured** — the CE, PCS, voiced-fraction, tuning-offset, plateau and
latency numbers above (`docs/eval/EVALUATION.md`, `docs/deploy/LOAD_TEST.md`).

**Remains** — the Harvard listening gate; a listening study with Somali
musicians (n ≫ 8); MusicGen-medium and longer clips (the 128 GB machine now
makes this a half-day, not a week); melody-conditioned generation from the
platform's own transcriptions; cassette-level (not song-level) splits for the
generative experiments to match the paper's own standard.

## Track 3 — Preservation: the platform and its governance

**Built**
- An invite-only archive platform (Next.js web, Expo mobile, Node API, Python
  AI service): field recording, transcription with hallucination gating for
  sung text, microtonal analysis, search, lessons, a research API; 233 API +
  102 mobile + 15 validator + 48 Python tests, zero-infrastructure test mode.
- A rights model that is enforced in code: archival audio never in git
  (`.gitignore` blocks audio, tokens, weights), private bucket with signed
  URLs, UUID object keys, provenance recorded on every item, performer names
  withheld for the private collection, provenance line on every model output.
- A processing corpus from the Aryette collection: 119 tracks, 11,386 clips,
  song-level splits, per-file `license_status=unknown` manifest.

**Discovered / decided**
- Cultural labels (genre, era) are assigned by Somali scholars, never
  predicted by the pipeline (`DATASET_STRATEGY.md`).
- MERT nearest neighbours retrieve same-cassette material at 13× chance:
  cassette-level splits are mandatory for any evaluation on archival tape (§7.3).

**Remains (blocking for public use)**
- Written permission from Harvard's Loeb Music Library for any public use of
  Aryette-derived material — outstanding.
- The deployed site's public serving of collection audio (demo stems;
  direct-URL listening-room files) must be removed or gated
  (`DATA_PROVENANCE.md`, BLOCKING item).
- Consent from the oud collection's holders before any public demo of that
  adapter's outputs beyond the research context.
- Rights-clear source recordings (own oud sessions, consented performers) —
  the only path to a fully publishable source → generated pairs demo.

## One-paragraph arc (for the opening)

An archive nobody had measured; a tonal system quantified per track by
turning the tape channel into a fitted parameter; a generative model that
appeared to fail on the material until a dropout defect in the training
harness was found, diagnosed with a five-condition probe, and fixed — after
which the same model learned the tradition's melodic density and its tuning
drift on two independent corpora; and a platform that keeps every source
recording where its rights holders left it while letting a professor hear the
result on a laptop in three minutes.

# QaraamiGen — project inventory (2026-09-27)

A factual inventory of everything in this repository, written to be studied and
to be explained to professors. Every claim names the file it comes from. Nothing
here is a plan; it is what exists on disk on branch `qaraami-v2` at commit
`e690034` plus the listening result recorded on 2026-09-27. Where the record is
inconsistent, both versions are stated.

One paragraph of orientation. The repository holds two things that share a
monorepo. The **platform** is an invite-only web and mobile archive for Somali
music (Next.js web app, Express API, Expo mobile app, FastAPI AI service). The
**research programme** fine-tunes Meta's MusicGen on Somali qaraami audio with
LoRA adapters, evaluates the adapters, serves them from a local inference
service, and feeds a paper draft and a PhD application package. The audio
itself is never distributed; only code, metadata, measurements and model output
are.

---

## 1. Web platform

### 1.1 Stack (from `apps/web/package.json`, `apps/web/next.config.mjs`)

It is **Next.js on React**, using the **App Router** (there is an `apps/web/app/`
tree and no `pages/` directory; `app/layout.tsx` line 2 says "Root layout
(Next.js App Router)").

| item | value | source |
| --- | --- | --- |
| Next.js | `^16.2.10` (installed 16.2.10) | `apps/web/package.json`, `node_modules/next/package.json` |
| React / ReactDOM | `19.2.3`, pinned by root `overrides` to match Expo SDK 57 | root `package.json` |
| Styling | Tailwind CSS v4 (`tailwindcss ^4.3.2`, `@tailwindcss/postcss`), `app/globals.css`, `app/tokens.css`; no CSS modules | `apps/web/postcss.config.mjs` |
| Fonts | Playfair Display, Nunito, IBM Plex Mono via `next/font/google` | `app/layout.tsx` |
| UI / state libraries | none; in-house React context (`components/player/PlayerProvider`, `components/theme/ThemeProvider`) | `apps/web/components/` |
| Audio / notation | `html-midi-player ^1.6.0` (pulls @magenta/music and tone), `verovio ^6.2.0`, custom oud/durbaan engine in `lib/audio/` | `apps/web/package.json` |
| Shared packages | `@sma/constants`, `@sma/types`, `@sma/validators` (raw `.ts`, compiled via `transpilePackages`) | `packages/*`, `next.config.mjs` |
| Unused dependency | `@openrouter/sdk ^1.2.4` is declared but not imported anywhere under `app/`, `components/`, `lib/` | grep |
| TypeScript / lint | TypeScript ^5.9.3 strict, eslint 9 with `eslint-config-next` 16 | `apps/web/package.json` |
| Middleware | `apps/web/proxy.ts` (the Next 16 proxy file): feature-flag redirects and the optional login gate | `apps/web/proxy.ts` |

### 1.2 Build and run

- Scripts: `dev` = `next dev -p 3000`, `build` = `next build`, `start` =
  `next start -p 3000`, `typecheck` = `tsc --noEmit`, `lint` = `eslint .`
  (`apps/web/package.json`).
- `next.config.mjs` has no `output` key, so it is the default server/hybrid
  output (not `export`, not `standalone`).
- **It is a production build that is served.** The Vercel project
  (`apps/web/.vercel/project.json`, `framework: "nextjs"`) leaves the build
  command null, so Vercel runs `next build` and serves that build at
  `https://somali-music-archive.vercel.app` on pushes to `master`
  (`CLAUDE.md`). `apps/web/.vercel/output/builds.json` records a local
  `vercel build --prod`. Node: root `engines` require `>=22.13.0 <23`,
  `.nvmrc` is `22`; the Vercel project setting is `24.x`, which does not match.
- `.vercelignore` excludes `apps/web/public/audio` and
  `apps/web/public/demos/audio` (the July 2026 CLI upload had shipped them).
- Locally the whole stack starts with `bash scripts/dev-up.sh` (API :3001, AI
  service :8000, web :3000 under pm2, MusicGen service :8765 under launchd).

### 1.3 Page routes (`apps/web/app/`)

There are no API route handlers in the web app (no `app/api/`, no `route.ts`).

| route | file | what it does |
| --- | --- | --- |
| `/` | `app/page.tsx` | Landing page: hero score read from `public/sample/` at build time, demo player, waveform-to-score section, stats. Copy in `lib/landingCopy.ts`, tracks in `lib/tracks.ts`. |
| `/listen` | `app/listen/page.tsx` | "Dhageyso", the listening room: recordings with source and rights lines, score synced to the transcribed take (`/sample/score.mei`, `/sample/session.json`). |
| `/library` | `app/library/page.tsx` | "Maktabadda": with auth on, lists and uploads scanned songbooks via API + R2; with auth off, shows the cleared Beerdilaacshe score. |
| `/transcribe` | `app/transcribe/page.tsx` | "Qormada", audio to sheet music: AI mode `off` shows three pre-rendered scores; otherwise `TranscribeStudio` uploads to the AI service `/notation` and polls the job. |
| `/generate` | `app/generate/page.tsx` | "Abuur", generation: mode `off` shows six pre-generated MP3s; otherwise `ServedGenerationStudio` calls the AI service `/demo/*` (default) or `GenerationStudio` calls the Node API `/generate`. |
| `/studio` | `app/studio/page.tsx` | Transcription studio shell: score canvas, waveform, inspector, transport, on the `/sample/*` fixtures. |
| `/daw` | `app/daw/page.tsx` | Composition DAW; hidden unless `NEXT_PUBLIC_ENABLE_DAW=true`. |
| `/scores/beerdilaacshe` | `app/scores/beerdilaacshe/page.tsx` | Engraved score of Abdillahi Qarshe's "Beerdilaacshe" with player and PDF/MIDI/LilyPond downloads. |
| `/courses`, `/courses/[id]` | `app/courses/` | Course list and course view; hidden unless `NEXT_PUBLIC_ENABLE_COURSES=true`. |
| `/learn`, `/learn/[id]` | `app/learn/` | Lesson list and lesson view; hidden unless `NEXT_PUBLIC_ENABLE_LEARN=true`. |
| `/login`, `/register` | `app/login/`, `app/register/` | Member sign-in (email or phone, optional Google) and invite-code registration. Member-only routes. |
| `/account`, `/dashboard` | `app/account/`, `app/dashboard/` | Member dashboard (`/dashboard` redirects to `/account`). |
| `/teach` | `app/teach/page.tsx` | Educator lesson publishing with presigned attachment upload. |
| `/admin`, `/admin/login`, `/admin/members`, `/admin/invites`, `/admin/organizations` | `app/admin/` | Recording moderation queue, admin login, member management, invite codes, institutional licences. |

Member-only routes (`lib/flags.ts` `MEMBER_ROUTES`) are disabled and redirect
to `/` when `NEXT_PUBLIC_REQUIRE_AUTH=false`, which is the public site's setting.

### 1.4 Where the frontend calls the backend

Two backends, both configured by env vars read in `apps/web/lib/flags.ts`,
`lib/api.ts` and `lib/aiService.ts`:

| env var | default | purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api/v1` | the Node API; every call goes through `apiFetch` in `lib/api.ts` (bearer token, one retry after a single-flight `/auth/refresh`) |
| `NEXT_PUBLIC_AI_URL` | `http://localhost:8000` | the FastAPI AI service |
| `NEXT_PUBLIC_AI_SERVICE_MODE` | `local` if `NEXT_PUBLIC_AI_URL` set, else `off` | `local` and `remote` behave identically in code; `off` renders the pre-rendered examples on `/transcribe` and `/generate`. The public site runs `off`. |
| `NEXT_PUBLIC_GENERATE_SERVED_ONLY` | true | use the AI service `/demo/*`; `false` routes through the Node API `/generate` provider tiers |
| `NEXT_PUBLIC_REQUIRE_AUTH`, `NEXT_PUBLIC_ENABLE_{COURSES,LEARN,DAW}`, `NEXT_PUBLIC_GATE_BYPASS`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | false / unset | feature flags and the login gate |

Node API endpoints called from the web app: `/auth/{login,google,register,logout,refresh}`,
`/users/me`, `/users`, `/recordings/moderation`, `/recordings/:id`, `/invites`,
`/organizations/*`, `/library/books/*`, `/education/lessons/*`, `/courses/*`,
`/studio/projects/*`, `/generate`, `/generate/:id`. File uploads go directly to
presigned R2 URLs with a plain `fetch` PUT (`uploadFileToR2`), never through the API.

AI service endpoints called from the web app: `GET /demo/config`,
`POST /demo/generate` (`lib/aiService.ts`; adapters whose id starts with
`harvard` are filtered out of the web list), `POST /notation`,
`GET /notation/jobs/:id`, `GET /notation/jobs/:id/artifacts/{svg,original,midi,…}`
(`components/transcribe/TranscribeStudio.tsx`).

### 1.5 Public assets

Tracked audio under `apps/web/public/` is eight MP3s: `sample/audio.mp3`,
`sample/hero-audio.mp3` (synthesised from a note list, `public/sample/README.md`)
and six `demos/generated/{large,medium,oud}_NNN_adapter.mp3` (model output).
`apps/web/public/audio/` (nine source recordings) is git-ignored (`.gitignore`
line 156) and returns 404 on the deployed site, while `lib/tracks.ts` still
references those paths.

### 1.6 Mobile app and monorepo

- `apps/mobile`: Expo SDK 57 (`expo ~57.0.4`, `expo-router ~57.0.4`,
  `react-native ^0.86.0`, React 19.2.3), axios, react-query, zustand,
  react-hook-form + zod, expo-secure-store. Screens under `apps/mobile/app/`:
  `(auth)/{welcome,login,register,forgot-password}`,
  `(tabs)/{discover,search,record,learn,profile}`, `archive/`, `artist/[id]`,
  `lesson/[id]`, `module/[id]`, `generate`, `reader`, `saved`. It uses the same
  Node API (`EXPO_PUBLIC_API_URL`) and never calls the AI service.
- Root: npm workspaces over `apps/*` and `packages/*`, Turborepo 2, Husky +
  lint-staged (Prettier), `npm test` = `turbo run test`, `npm run typecheck`.
- CI (`.github/workflows/ci.yml`): Node job (`format:check`, `typecheck`, `test`
  with mongodb-memory-server and embedded-postgres, `build`) and Python job
  (`ruff check .`, `pytest -q` in `apps/ai-service`, without the ML wheels).
  Nothing in CI tests `services/musicgen-api`.

---

## 2. Backend and services

### 2.1 Node API (`apps/api`, Express 4, TypeScript strict)

- Deps: express ^4.19, zod ^3.23, mongoose ^8.24 (MongoDB), @prisma/client ^5.22
  (PostgreSQL), redis ^6 with express-rate-limit, jsonwebtoken, bcryptjs,
  google-auth-library, helmet, pino, @aws-sdk/client-s3 + s3-request-presigner
  (Cloudflare R2). **No Stripe dependency** despite the `CLAUDE.md` stack line.
- Entry: `src/server.ts` → `src/app.ts` (helmet, cors, json 10 MB, pino-http,
  `/health`, `/api/v1` behind a rate limiter). `src/vercel.ts` + `apps/api/vercel.json`
  for serverless deployment.
- Persistence: `PERSISTENCE=memory|database` (default memory); tests always in memory.
- Modules mounted under `/api/v1` (`src/routes.ts`): `auth`, `invites`, `users`,
  `recordings` (presigned upload URL, moderation, audio URL), `lessons`,
  `education`, `courses`, `studio` (DAW project sync), `search`, `notifications`,
  `organizations`, `comments`, `collections`, `library`, `research` (API keys,
  dataset), `generate`, `internal`.
- Generation providers (`src/modules/generation/providers/`): `suno`, `lyria`
  (OpenRouter or Gemini), `local`. `local` posts to the AI service `/generate`,
  which is gated off (403/501); the only live path to MusicGen is the AI
  service's `/demo/*`. Keyless providers become fakes outside production.
- Auth: JWT access (15 m) + refresh (30 d), `jti` blacklist on logout, Google
  sign-in, bcrypt. Tests: vitest, 37 `*.test.ts` files.

### 2.2 AI service (`apps/ai-service`, Python 3.11, FastAPI)

`main.py` mounts routers health, transcribe, pitch, embed, notation, generation,
demo, review:

| endpoint | what |
| --- | --- |
| `POST /transcribe` | Whisper large-v3 **speech** transcription job (internal key) |
| `POST /pitch/extract` | CREPE pitch job with Somali scale analytics |
| `POST /embed` | MERT-v1-95M embeddings |
| `POST /notation`, `GET /notation/jobs/{id}`, `…/artifacts/{kind}` | public audio-to-sheet-music jobs |
| `POST /generate` | gated: 403 unless `GENERATION_ENABLED=true`, then 501 |
| `GET /demo`, `/demo/config`, `POST /demo/generate`, `GET /demo/audio/{id}` | the served demo, proxied to the MusicGen service with the token kept server-side |
| `/demo/review/*` | phrase-by-phrase listening review with annotator state and export |

The music transcription pipeline (`scripts/transcribe.py`, driven by
`services/notation_service.py`): Demucs htdemucs separation → CREPE pitch
(`vocal_f0.py`) → tonic and pentatonic scale estimate (`quantize.py`,
`pentatonic.py`) → note segmentation (`f0_notes.py`), melody skyline
(`melody.py`), pentatonic quantisation keeping cents deviation → beat grid
(`beat_grid.py`) → MusicXML via music21, PDF via MuseScore 4 or Verovio SVG,
MIDI, JSON, report. Batch and benchmark: `transcribe_pool.py`, `pool_report.py`,
`pick_benchmark_items.py`, `make_annotation_pack.py`, `transcription_metrics.py`;
status in `docs/eval/TRANSCRIPTION_STATUS.md` (2026-09-14, 91-recording pool).

The MusicGen research scripts, all under `apps/ai-service/scripts/`:

| script | role |
| --- | --- |
| `phase1_preprocess.py`, `phase1_tokens.py` | Harvard clips (32 kHz mono, −14 LUFS, 15 s) and EnCodec tokens |
| `phase2_train.py` | LoRA fine-tune of musicgen-small; holds `zero_functional_dropout` |
| `phase3_generate.py`, `phase3_pcs_run.py`, `phase3_token_loss.py` | generation, PCS over a directory, held-out CE |
| `phase4_ablation.py` | transcription ablation (paper §7.6) |
| `probe_train_eval_gap.py` | the five-condition probe that diagnosed the dropout defect |
| `build_scale_dataset.py`, `scale_tokens.py`, `scale_chroma.py` | 30 s clip sets, tokens, melody chroma |
| `scale_train.py`, `scale_eval.py` | the scaled harness (medium/large/melody) and its evaluator |
| `dpo_train.py`, `reward_model.py`, `dpo_report.py` | preference optimisation toward clean oud |
| `restore_clips.py` | spectral-subtraction cassette restoration |
| `pcs.py`, `pentatonic.py` | Pentatonic Conformity Score, tonic and scale detection |
| `ab_listen.py` | loopback A/B listening server with blind paired test |
| `eval_report.py`, `model_report.py`, `build_demo_page.py` | tables, figures, model cards, demo page |
| `ahmed_extract.py`, `ahmed_classify.py`, `build_sets.py`, `corpus_report.py`, `separate_stems.py`, `melody_midi.py` | the v2 corpus pipeline (inventory, classification, sets, Demucs, MIDI) |
| `harvard_fetch.py`, `harvard_gap_report.py`, `internet_acquire.py`, `internet_rights_review.py`, `intake.py` | acquisition and rights review |
| `register_adapter.py`, `showcase.py`, `showcase_final.py`, `improve_loop.py`, `melody_condition.py`, `ace_step_generate.py` | serving, showcase sets, the improvement loop, melody and vocal experiments |

Tests: 46 `test_*.py` files in `apps/ai-service/tests/` (214 passed, 1 skipped
on 2026-09-24 per `CLAUDE.md`). Pinned runtime deps in
`apps/ai-service/requirements.txt`; the training environment is
`~/ai/musicgen-env` (torch 2.14.0, transformers 4.57.6, peft 0.20.0).

### 2.3 MusicGen inference service (`services/musicgen-api/`)

- `app.py`: one engine per base model, loaded on MPS; endpoints `GET /health`
  (no auth), `GET /adapters`, `POST /generate` (prompt, duration ≤ 30 s, cfg,
  seed, adapter, score), `GET /audio/{id}`, `GET /generations/{id}`, `POST /pcs`,
  `GET /demo`. Batch size is always 1; one worker lock per engine; queue of 3
  then 429 with `Retry-After: 15`. Adapters are hot-swapped with PEFT.
- `serve.py` binds `127.0.0.1` and the Tailscale IP only, never `0.0.0.0`.
  Token from `~/ai/musicgen-api/musicgen-api.env`. launchd label
  `com.qaraamigen.musicgen-api` (`docs/deploy/DEPLOY.md`).
- Registered adapters (`BUILTIN_ADAPTERS` in `app.py`; `adapters.extra.json` is `[]`):

| adapter | checkpoint | base | rights |
| --- | --- | --- | --- |
| `oud` | `runs/oud_lora_r16_nodrop_20260809/ckpt_step_0500` | musicgen-small | releasable |
| `harvard_raw` | `runs/harvard_raw_3000/ckpt_step_2750` | musicgen-small | research_only |
| `large` | `runs/qaraami_large_r32/ckpt_step_2750` | musicgen-large | research_only |

No DPO adapter and no `qaraami_all` adapter is served.

### 2.4 Root scripts and run tooling

`scripts/dev-up.sh`, `dev-status.sh`, `dev-down.sh` (local stack under pm2 +
launchd); `scripts/reproduce_oud_smoke.sh` (re-runs the fixed-harness smoke
test and checks the recorded numbers); build helpers for the hero, sample
session, score and design tokens; Vercel deploy and env-push helpers.
`runs/_tools/` holds the tmux orchestrators for every training campaign
(`orchestrate.sh`, `_3000`, `_scale`, `_dpo`, `_ahmed`, `_v2`), set-build
chains, memory guards, CE evaluators, and the `qaraami_all_*` post/guard/result
scripts.

---

## 3. The ML side

### 3.1 Harnesses

- `phase2_train.py`: musicgen-small, LoRA r16 α32 on q/k/v/out projections
  (192 sites), lr 1e-4 cosine with 100 warm-up, batch 1 × grad-accum 4, fp32,
  gradient checkpointing, precomputed EnCodec tokens turned into delay-pattern
  labels. `runs/_tools/train_run.py` wraps it for the September reruns.
- `scale_train.py`: medium, large and melody; LoRA r32 α64 on
  q/k/v/out/fc1/fc2 (480 sites on medium), rows may carry their own
  `tokens_dir`/`chroma_dir`, `--mem-cap-gb`, `--resume-from`, `--full-decoder`,
  `--early-stop-patience` (min delta 0.002), `--max-hours`; completion marker
  `SCALE_TRAIN_DONE`.
- `dpo_train.py`: one DPO round per call, K × P sampled clips scored by
  `reward_model.py` (MERT oud distance, hiss/SNR, PCS), best-vs-worst pairs,
  held-out oud CE as a collapse guard.

### 3.2 The dropout defect and its fix

MusicGen hub configs carry `dropout=0.1` (plus `activation_dropout`,
`attention_dropout`) although audiocraft trained with 0. In train mode
transformers applies these through functional `F.dropout(..., training=self.training)`
calls that `nn.Dropout` sweeps do not reach. The probe
(`apps/ai-service/scripts/probe_train_eval_gap.py`; table in
`docs/eval/EVALUATION.md` lines 152–164): on identical weights and four oud val
clips, eval-mode loss 4.0511, train-mode 9.7356, train with nn.Dropout p=0
9.7337, no gradient checkpointing 9.7879, encoders in eval 9.7525; the
uniform-random reference ln(2048) is 7.6246. So optimisation in train mode fit
a forward path worse than random, and val loss climbed from ~4.5 to ~7.2 by
step 250 in every July and early-August run.

The fix is `zero_functional_dropout()` (`phase2_train.py` lines 112–129, copy
in `scale_train.py` lines 155–163): walk `model.modules()` and set `dropout`,
`activation_dropout`, `attention_dropout` floats to 0.0. It zeroes 37
attributes on musicgen-small and 61 on medium and large (train logs). Every run
from `oud_lora_r16_nodrop_20260809` onward uses it, and each log prints the
count. Minimal repro and drafts for upstream are in `docs/oss/`
(`musicgen_dropout_repro.py`, `transformers_musicgen_dropout_issue.md`,
`transformers_musicgen_dropout_fix.diff`, plus two companion issue drafts).
`CLAUDE.md` and `docs/application/RESEARCH_STATEMENT_NOTES.md` record the issue
as filed, huggingface/transformers #49094 on 2026-09-24; the draft file's
header still says "not yet filed" and the PR diff is marked "not opened".

### 3.3 Every training run in `runs/`

Val figures are step-0 → best from `loss.csv`; test CE from `eval_*.json` or
`test_ce.json`. "Broken" means trained before the dropout fix.

| run | base | data | harness | outcome |
| --- | --- | --- | --- | --- |
| `smoke` (2026-07-17) | small | 20 clips | phase2 smoke, broken | 50 steps |
| `lora_r16_20260717` | small | Harvard raw, 9,174 clips, lr 1e-4, 1500 steps | phase2, broken | val 4.6262 → 6.6977 at step 1000; test 4.8363 → 6.7525. The July negative result. |
| `lora_r16_lr2e5_20260718` | small | Harvard raw, lr 2e-5 | phase2, broken | stopped at 400; val 4.7635 (100) → 6.7883 (250) |
| `oud_lora_r16_lr1e5_20260809` | small | oud, lr 1e-5 | phase2, broken (diagnostic) | stopped at 250; val 4.5244 (100) → 7.2298 (250) |
| `oud_lora_r16_nodrop_20260809` | small | oud collection, 1,512 clips, 28 songs, 1000 steps | phase2, **first fixed run** | val 4.5132 → 4.4785 (step 500); test 2.6302 → 2.6092 (clip mean); A/B `data/oud_ab_listening/`; served as `oud` |
| `oud_smoke`, `smoke_m5max_20260902`, `repro_oud_smoke_20260904_115626` | small | 20 clips | phase2 smoke | reproducibility checks; the 09-04 log shows "functional dropout zeroed on 37 attrs" |
| `harvard_raw` (2026-09-03) | small | `data/captions.jsonl`, 9,174 clips, 1500 steps | train_run | val 4.6262 → 4.5585; test 4.8363 → 4.7585 |
| `harvard_denoised` | small | DeepFilterNet3-denoised clips | train_run | val 2.3524 → 2.2780 on denoised tokens (not comparable with raw; kept as negative control) |
| `harvard_raw_3000` | small | Harvard raw, 3000 steps | train_run | val 4.6262 → 4.5501 (2750); test 4.8363 → 4.7468, n = 128 clips, no CI; A/B `data/harvard_ab_listening/`; served as `harvard_raw` |
| `harvard_restored` (2026-09-08) | small | spectral-subtraction restored clips, 1500 steps | train_run | on raw tokens base 4.8363 → 4.7756 (raw adapter 4.7585): restoration keeps 78 % of the gain (`docs/eval/RESTORATION.md`) |
| `smoke_medium`, `smoke_large` (2026-09-04) | medium, large | 953 clips | scale_train smoke | memory probes |
| `qaraami_medium_r32` (2026-09-04/05) | medium | `data/scale_captions.jsonl`, 43 h, 7,857 train clips, 3000 steps | scale_train | val 4.4584 → 4.3724 (2750); per-song test 4.1011 → 3.9996, +0.1016 [0.0779, 0.1232], 27 songs; A/B `data/ab_medium/` |
| `qaraami_large_r32` (2026-09-05) | large | same | scale_train | val 4.4305 → 4.3244 (2750); per-song 4.0750 → 3.9469, +0.1282 [0.1042, 0.1517]; A/B `data/ab_large/`; served as `large` |
| `dpo_probe_medium`, `dpo_small_oud`, `dpo_medium_v1`, `dpo_medium`, `dpo_large` (2026-09-08) | small/medium/large + SFT adapter | 62–144 preference pairs | dpo_train | `dpo_medium_v1` failed the collapse guard (oud CE 4.20 → 5.70); `dpo_large` oud CE 4.1418 → 4.1797, band SNR 19.8 dB, A/B `data/ab_dpo_large/`; `dpo_medium` CE 4.2033 → 4.2686. Details `docs/eval/PREFERENCE_OPT.md`. |
| `ahmed_only` (2026-09-25) | medium | `ahmed_oud` set, 699 clips | scale_train | stopped at step 400 ("superseded by qaraami-v2 brief"); val 4.2819 → 4.2372 (250) |
| `qaraami_all` (2026-09-26/27) | medium | whole corpus, 1,220 songs, 247.9 train clip-h, 29,753 clips, 3000 steps | scale_train | val 4.3679 → 4.2825 (3000; plateau, +0.0016 over the last 750 steps); per-song test 4.2107 → 4.1343, +0.0764 [0.0687, 0.0837], 64 songs stratified over ahmed_mix / ahmed_oud / harvard_full; A/B `data/ab_qaraami_all/`; `runs/qaraami_all/RESULT.md` |

Planned but never run: `ahmed_only_large`, `combined_large`, `ahmed_melody`
(`runs/_tools/orchestrate_ahmed.log`) and the v2 recipes `qaraami_medium_full`,
`qaraami_large`, `qaraami_large_all`, `qaraami_melody`
(`docs/eval/QARAAMI_MODEL_REPORT.md` shows them "not run"). The melody LoRA has
never been trained; `data/ab_melody/` is a base-model demo only.

### 3.4 Evaluation tooling and what has been recorded

- `scale_eval.py`: per-song held-out CE with a 2,000-resample bootstrap 95 %
  CI over songs (the independent unit), 16-clip seeded A/B set with PCS and
  voiced fraction, optional MERT-FAD against real clips and a Turing set.
  Recorded with CIs: medium, large, qaraami_all. Small runs and DPO have
  clip-mean CE without CI. MERT-FAD exists only in the DPO evals; no Turing set
  has been generated.
- `pcs.py`: Pentatonic Conformity Score, torchcrepe f0 → confidence gate →
  tuning offset → tonic/scale → fraction of voiced frames within ±50 cents.
- `ab_listen.py`: loopback listening server; blind paired test with randomised
  order, hidden names, "neither" allowed, Wilson 95 % interval; results in
  `data/listening/<set>_<listener>_<timestamp>.json`.
- `eval_report.py` → `docs/eval/TABLES.md` and `docs/figures/`;
  `model_report.py` → `docs/eval/QARAAMI_MODEL_REPORT.md` and model cards.
- Reports: `docs/eval/EVALUATION.md` and `TABLES.md` (2026-09-04, small
  models), `SCALING_REPORT.md` (09-05), `PREFERENCE_OPT.md` and
  `RESTORATION.md` (09-08), `QARAAMI_MODEL_REPORT.md` (09-26, without the
  qaraami_all row). Model cards exist only for `oud` and `harvard_raw`
  (`docs/eval/MODEL_CARD_*.md`); none for medium, large, DPO or qaraami_all.

---

## 4. Data

### 4.1 Rights (from `docs/DATA_PROVENANCE.md`)

Governing rules, quoted: archival audio is "never committed to git"; the
platform is invite-only; storage is a private bucket with signed, expiring URLs
and UUID keys. Per source:

| source | rights | what may be public |
| --- | --- | --- |
| Harvard, Maryan "Aryette" Omar Ali Collection (AWM Spec Coll 103) | "NOT rights-cleared … written permission from the Loeb Music Library is outstanding" | nothing: "no recording from this collection may be included in any public artifact or demo"; adapters trained on it are research-only and never served publicly |
| Ahmed Ilkacase sessions (`data/ahmed_raw/`, 27 Logic + 178 GarageBand projects) and his oud collection (`data/raw_incoming/oud_ilkacase/`, 40 files / 28 songs) | consented for training; adapters may be published once the written consent record exists (`docs/data/consent/` holds only a README) | adapters and model output; never the audio |
| Internet acquisition (`data/internet/`) | reviewed item by item (`docs/data/INTERNET_RIGHTS_REVIEW.md`): 20 `internet_cc` publishable with attribution, 99 research-only, 44 excluded as not Somali music | CC items with attribution |
| Beerdilaacshe score, sample session, hero | the project's own engraving and synthesis | yes (tracked fixtures) |
| Model-generated audio | research artifacts, labelled "AI-generated" | yes, labelled |

Open items in the provenance file: the Harvard Loeb letter; the deployed site's
older `/demos/audio/…` and `/audio/…` exposures (the source recordings now
return 404, verified 2026-09-24 per `CLAUDE.md`); a provider-terms review.

### 4.2 Corpora and hours (`docs/data/CORPUS_REPORT.md`, 2026-09-26; set cards in `data/sets*/*/SET_CARD.md`)

| corpus | rights tier | files all / kept | unique h | kept h |
| --- | --- | --- | --- | --- |
| Ahmed sessions | `ahmed_ilkacase_consented` | 1305 / 975 | 92.38 | 75.69 |
| Ahmed oud collection | `ahmed_ilkacase_consented` | 40 / 28 | 4.09 | 4.09 |
| Harvard Aryette | `harvard_research_only` | 765 / 749 | 124.11 | 115.40 |
| Internet CC | `internet_cc` | 20 / 19 | 1.75 | 1.62 |
| Internet research-only | `internet_research_only` | 99 / 99 | 15.82 | 15.82 |
| Internet excluded | `excluded_not_somali_music` | 44 / 0 | 22.61 | 0 |

Totals in the report: 81.39 h publishable, 131.22 h research-only ("62 % of the
kept corpus cannot back a served model"). The older Stage 1 inventory
(`docs/data/CORPUS_INVENTORY.md`, 2026-09-04, 43.14 h) recorded "0 hours cleared
for any public artifact" before the Ahmed consent was identified.

Training sets (30 s clips, 50 % overlap, song-level splits, leakage-checked; clip-hours with source hours in parentheses):

| set | songs | train / val / test clips | clip-h (source h) | rights |
| --- | --- | --- | --- | --- |
| `ahmed_mix` | 113 | 7452 / 596 / 651 | 72.49 (39.70) | consented |
| `ahmed_oud` (includes the oud collection) | 26 | 699 / 232 / 105 | 8.63 (5.01) | consented |
| `ahmed_vocal` | 42 | 836 / 195 / 44 | 8.96 (5.87) | consented |
| `harvard_full` | 744 | 21370 / 2937 / 2076 | 219.86 (114.70) | research-only |
| `internet_mix` | 12 | 165 / 62 / 0 | 1.89 (1.02) | CC |
| `internet_oud` | 3 | 67 / 0 / 0 | 0.56 (0.30) | CC |
| `sep_oud` (Demucs-isolated oud) | — | 1055 / 29 / 68 | no set card | consented |

Ten-second versions of the same sets live in `data/sets_10s/`. Merged run
captions: `run_ahmed_only` (1,036 rows), `run_ahmed_only_large` (9,735),
`run_qaraami_all` (36,412: 26,383 Harvard, 9,735 Ahmed, 294 internet CC).
Earlier corpora: `data/captions.jsonl` (11,386 rows, the 43 h scale corpus
including Harvard and the `.band` imports of mixed rights) and
`data/oud_captions.jsonl` (1,921).

### 4.3 What git tracks

`git ls-files` shows 100 text/JSON files under `data/` (cards, captions,
inventories, listening results, eval JSON) and nine MP3s in total, all
project-owned synthesis or model output. No `.wav`, `.flac`, `.m4a`, `.npy`,
`.pt`, `.safetensors` or `.bin` is tracked; `.gitignore` blocks audio, tokens,
checkpoints, `data/harvard_raw/`, `data/ahmed_raw/`, `data/raw_incoming/`,
`data/separated/`, and every `data/ab_*/` directory. Caption rows derived from
Harvard (caption text, source file names) are tracked in `data/captions.jsonl`
and, since commit `e690034`, in `data/sets/run_qaraami_all_captions.jsonl`;
the branch is not pushed.

Known staleness: `CORPUS_REPORT.md` predates the finished Harvard separation
(index now 993 rows, not 429), the rebuilt 10 s Harvard set, `sep_oud` and the
`run_qaraami_all` merge.

---

## 5. Setbacks and what we learned

**The dropout bug (July–August 2026).** Two months of runs on musicgen-small
showed val loss rising from 4.6 to 6.7–7.2 within 250 steps at every learning
rate tried, on both corpora. The paper draft's abstract recorded it as a
negative result: "generative adaptation learns the channel, not the tradition".
The probe in §3.2 showed the cause was the harness, not the data: train mode
ran a forward path worse than uniform random because of functional dropout
attributes the hub config sets to 0.1 and audiocraft never used. With them
zeroed, every run since improves on unseen songs. Lesson: check that train-mode
loss equals eval-mode loss on identical weights before trusting any curve; the
probe now runs before every training campaign, and every log prints the count
of zeroed attributes. The finding is written up for upstream in `docs/oss/`.

**The listening results, in order** (all from `data/listening/*.json`, one
listener, Khalid, blind paired protocol, "neither" allowed):

| set | model | date | adapter / base / neither | note |
| --- | --- | --- | --- | --- |
| `oud_ab_listening` | small, oud adapter | 2026-08/09 | recorded as **passed** in `CLAUDE.md` and `docs/eval/MODEL_CARD_oud.md` | no `data/listening` JSON exists for it; the blind-test tool came later, so this is the one gate without a machine record |
| `ab_large` | large SFT | 2026-09-08 | 11 / 2 / 3, then 6 / 0 / 10 the same day | the only SFT adapter preferred over base |
| `ab_medium` | medium SFT | 2026-09-08, re-sit 09-24 | 3 / 0 / 13, then 1 / 0 / 15 | metric gain, no audible preference |
| `harvard_ab_listening` | small, harvard_raw | 2026-09-24 | 0 / 0 / 8 | 8 pairs |
| `ab_dpo_large` | large + DPO | 2026-09-24 | 22 / 12 / 6, then 12 / 10 / 18 (n = 40) | first sitting 0.55 [0.40, 0.69]; the second regressed to chance |
| `ab_dpo_medium` | medium + DPO | 2026-09-24 | 6 / 8 / 26 | |
| `ab_restore_harvard` | raw vs restored clips | 2026-09-24 | 5 / 2 / 1 restored | restoration audible |
| `ab_qaraami_all` | medium, whole corpus | 2026-09-27 | 1 / 0 / 15, rate 0.06 [0.01, 0.28] | 300 h of data did not change the medium result |

**What the numbers say together.** Every fixed-harness adapter lowers held-out
token cross-entropy on unseen songs, and for medium, large and qaraami_all the
bootstrap intervals clear zero (+0.10, +0.13, +0.08 nats). Those are 2–3 % of
the loss. The listening tests do not follow the metric: on the medium model
the listener chose "neither" in 28 of 32 pairs across two sittings and in 15 of
16 for qaraami_all; only the large model, and its DPO round in one of two
sittings, was audibly preferred. The 2026-09-19 diagnosis in `CLAUDE.md`
matches: the SFT adapters add noise (spectral flatness 0.02–0.07 against 0.005
for base output and 0.002 for real clips), produce far more voiced material
(voiced fraction 0.42 → 0.70 on qaraami_all) but with lower pentatonic
conformity (0.85 → 0.74), and prompt engineering, half strength, temperature
and CFG did not remove the noise; DPO on the large model did (band SNR 19.8 dB).

**The honest conclusion about base model and scale.** Going from 43 h to 300 h
of training audio on the medium model gave a smaller per-song gain (+0.076
versus +0.102, on different test sets) and a curve that plateaued by step 2250.
LoRA r32 on musicgen-medium over 30 s cassette clips appears to be near what
this setup can extract, and what it extracts is not yet what a Somali listener
recognises as qaraami. The audible gains came from a bigger base model (large)
and from preference optimisation, not from more data or more steps. Two
caveats on every listening number: a single listener, and n = 16 or 40 pairs,
so they are directional; the protocol exists for a multi-listener study but no
second listener has sat. Rights limit the path forward as much as modelling
does: 62 % of the kept audio is research-only, so the large adapter that
listeners preferred cannot be served publicly, and no adapter trained on
Harvard rows can be published until the Loeb letter exists.

**Smaller setbacks on record.** `dpo_medium_v1` collapsed (oud CE 4.20 → 5.70)
and was caught by the guard, which led to reward v2 with an SFT anchor.
`ahmed_only` was stopped at step 400 when the brief changed. Four v2 recipes and
three Ahmed-corpus runs were scripted and never run. The July run was OOM-killed
generating samples at batch 4, which is why batch size is now always 1.

---

## 6. Read these files in order

1. `README.md` — what the project is, the five-minute reviewer path, rights in one paragraph.
2. `docs/DATA_PROVENANCE.md` — every source, its rights, what may ever be public.
3. `docs/ARCHITECTURE.md` — the research system: pipeline, models, evaluation rules, storage.
4. `docs/README-platform.md` — the platform itself (web, API, mobile, AI service) and how it is run.
5. `docs/eval/EVALUATION.md` — the small-model story including the probe table that found the dropout defect.
6. `docs/oss/transformers_musicgen_dropout_issue.md` (with `musicgen_dropout_repro.py`) — the defect stated for an outside reader, with the measured numbers.
7. `apps/ai-service/scripts/scale_train.py` — the fixed harness as used for every medium/large run; read `zero_functional_dropout` first.
8. `apps/ai-service/scripts/scale_eval.py` — how per-song CE, bootstrap CIs, PCS and the A/B sets are produced.
9. `docs/eval/SCALING_REPORT.md` — small → medium → large with confidence intervals.
10. `docs/eval/PREFERENCE_OPT.md` — the DPO rounds, the collapse and the one audible win.
11. `runs/qaraami_all/RESULT.md` — the whole-corpus run: data table, loss curve, test CE, A/B set.
12. `docs/ISMIR_PAPER_DRAFT.md` — the paper; its abstract still states the July negative, with seven `TODO —` blocks holding the corrected text awaiting approval.

After those: `docs/data/CORPUS_REPORT.md` for the hours behind every set,
`data/listening/*.json` for the raw listening records, and
`apps/ai-service/scripts/ab_listen.py` to hear the pairs yourself.

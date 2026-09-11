# Somali Music AI Preservation Platform

**The first AI-powered archive of Somali traditional music.**

Somali music — *heello*, *qaraami*, *dhaanto*, *buraanbur*, and the sung poetry of
*gabay* — is a living oral tradition with no representation in any major music
dataset or MIR corpus. This platform records, preserves, annotates, and teaches it:
a mobile field-recording app, an AI enrichment pipeline that transcribes lyrics and
measures the tradition's microtonality, a public archive with search and lessons,
and a documented Research API for the ethnomusicology community.

Built by **Khalid Ibrahim** — Somali-American AI engineer, Minneapolis MN.

## What makes this technically interesting

- **A tonal system, measured for the first time.** CREPE pitch tracks are mapped
  onto a Somali pentatonic reference and each frame's **deviation from Western
  equal temperament is quantified in cents** (`apps/ai-service/services/scale.py`
  — deliberately dependency-free and unit-tested). The reference frequencies are
  calibrated against master performers, not asserted from Western theory. This is
  the core contribution of the accompanying ISMIR paper draft (`docs/ISMIR_DRAFT.md`).
- **Sung text is not speech.** Whisper hallucinates over melisma; every transcript
  segment is gated by hallucination heuristics and flagged `is_singing`, stored as
  advisory rather than ground truth.
- **A 605-recording research corpus** from Harvard's Archive of World Music is
  processed end-to-end by `apps/ai-service/notebooks/harvard_pipeline.ipynb`
  (denoise → source-separate → transcribe → pitch-map → dataset), then ingested via
  `npm run ingest:harvard` — landing in the moderation queue, never auto-published.

## Architecture at a glance

```
apps/mobile      React Native (Expo SDK 57) — recording, archive, lessons, offline
apps/web         Next.js 15 — marketing site + admin dashboard (moderation, orgs)
apps/api         Node 22 + Express — auth (JWT+RBAC), recordings, search,
                 collections/comments, research API. TypeScript strict, Zod on
                 every input.
apps/ai-service  Python 3.11 + FastAPI — Whisper large-v3, CREPE, MERT embeddings
packages/*       shared types, validators (Zod), constants (genres/instruments
                 with cultural documentation)
```

- **Storage:** Cloudflare R2. Audio never flows through Node — presigned URLs only.
- **Data:** MongoDB (recording metadata) + PostgreSQL/pgvector (users, embeddings),
  behind repository interfaces with an in-memory implementation, so the entire
  platform runs and tests with **zero infrastructure** (`PERSISTENCE=memory`,
  the default) and cuts over to real databases with one flag.
- **Principles:** soft delete only — recordings are never destroyed; UUID object
  keys; bcrypt(12); provenance recorded on every archival item.

Full specification: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (build phases
in §16; as-built notes in Appendix A). Decisions:
[`docs/DECISIONS.md`](docs/DECISIONS.md). Data sources and rights:
[`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md).

## AI music generation (Suno · Lyria · our own model)

The newest layer: describe a song on the web **/generate** page or the mobile
**Generation Studio** and the platform composes it with AI — routed through one
provider-agnostic backend contract.

```
web / mobile ──▶ POST /api/v1/generate { provider, prompt, … } ─▶ 201 job
             ◀─ GET  /api/v1/generate/:jobId  (poll ≥3s)  ◀────── succeeded/failed
                                │
                        provider registry (apps/api/src/modules/generation)
                        ├─ suno   → api.sunoapi.org reseller (async task + poll)
                        ├─ lyria  → Google Gemini API (sync, budgeted submit)
                        └─ local  → Python ai-service (our fine-tuned model;
                                    gated until corpus licensing clears)
```

Design properties worth knowing:

- **Keys live only in the API** (`SUNO_API_KEY`, `GEMINI_API_KEY` — see
  [`SETUP.md`](SETUP.md) for how to get each). The apps never talk to a
  provider and never see a key.
- **Swappable by construction** (ADR-0005): every provider implements one
  `MusicProviderClient` interface (`submit`/`poll`), and every provider —
  synchronous or async — is normalised onto the same job you poll. Replacing
  Suno/Lyria with the archive's own fine-tuned model is one class + one
  registry line; zero app changes.
- **Keyless demo**: with no keys set, dev/test serve a built-in fake provider,
  so the full generate→poll→play loop runs offline and free.
- **Serverless-safe**: jobs persist in Redis (Upstash) in production so POST
  and polls can land on different lambdas; Lyria's long synchronous call is
  handled by a budgeted submit + `waitUntil` continuation; Suno results arrive
  by poll-through (no background workers anywhere).
- **Cost brake**: generation requires sign-in and is limited to 10
  jobs/hour/user; generated pieces are labeled AI-experiments, deliberately
  outside the preservation archive.

## Quickstart

```bash
npm install
cd apps/api && npm run seed     # dev accounts + 5 sample recordings
npm run dev                     # API on :3001 (in-memory persistence)

cd ../web && npm run dev        # web on :3000 — admin at /admin/login
cd ../mobile && npx expo start  # mobile (dev build; see eas.json)
```

The seed prints its account credentials (an admin and a contributor).

## Testing — the part worth copying

```bash
npm run test        # everything: 233 API + 102 mobile + 15 validators + 48 python
npm run typecheck   # TS strict everywhere, no `any`
cd apps/api && npm run doctor   # production-readiness probe (see below)
```

Every persistence path is tested against **real databases with no Docker and no
external services**: MongoDB via `mongodb-memory-server`, PostgreSQL via
`embedded-postgres` (schema applied with `prisma db push` at suite start). The
integration suites assert what in-memory doubles cannot — unique constraints,
foreign keys, soft-delete retention at the SQL layer, index materialisation.
CI (GitHub Actions) runs the full matrix on every push.

**Local stack, supervised.** `bash scripts/dev-up.sh` starts the API (port
3001, in-memory persistence seeded from `apps/api/.data/dev-store.json`), the
AI service (8000) and the web app (3000) under pm2 with health checks and
restarts, and checks the MusicGen inference service (8765, a launchd user
agent). `scripts/dev-status.sh` reports, `scripts/dev-down.sh` stops; logs go
to `logs/`. The API is given `PERSISTENCE=memory` and a CORS list covering
`localhost` and `127.0.0.1` on port 3000, so signing in locally never depends
on the cloud databases in `apps/api/.env`.

**Listening review** (`http://127.0.0.1:8000/demo/review`). For the musicians
who check the transcription benchmark by ear rather than from the page: each
transcribed recording (the annotation packs in `data/annotation/`, every pool folder in `data/transcription_pool/`, the demos) is cut into phrases of about four bars
along the beat grid the score was snapped to, and every phrase can be heard
as the recording and as the machine's notes played back on the same
timeline. Verdicts (correct, wrong notes, wrong rhythm), a note and the
listener's own recorded version save at once to
`data/annotation/<slug>/review_<name>.json`; `…/export.md` lists the phrases
marked wrong with bar numbers and timestamps for the fix in MuseScore.
`bash scripts/dev-up.sh --lan` opens the service to the local network for an
iPad; recording needs an https address (`Tailscale serve`, printed by the
script). The source audio is served only inside this service.

`npm run doctor` probes env completeness, Postgres schema + pgvector, Mongo +
indexes, Redis, R2, and the AI service — a ✓/△/✗ readiness report whose
database verdicts are themselves integration-tested.

## Research

- **Paper draft:** [`docs/ISMIR_DRAFT.md`](docs/ISMIR_DRAFT.md) — corpus +
  microtonality method + cultural-governance model.
- **Pipeline notebook:** [`apps/ai-service/notebooks/harvard_pipeline.ipynb`](apps/ai-service/notebooks/harvard_pipeline.ipynb)
  — the reproducible path from raw archive WAVs to the annotated dataset,
  including the paper's Figure 1.
- **Dataset strategy:** [`docs/DATASET_STRATEGY.md`](docs/DATASET_STRATEGY.md) —
  provenance, licensing, and governance. Cultural labels (genre, era) are assigned
  by Somali music scholars, never predicted by the pipeline.

## Status

Phases 0–4 complete (auth, recording flow, AI pipeline, search, lessons,
payments, i18n with RTL, admin, community features, performance). Phase 5 —
production cutover — is in progress; the build-phase plan is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §16.

## License & contact

All recordings remain under the rights of their communities and performers;
see `docs/DATASET_STRATEGY.md` for the governance and licensing model.
Code license: TBD before public release.

Khalid Ibrahim · Somali Music AI Preservation Platform · Minneapolis, MN

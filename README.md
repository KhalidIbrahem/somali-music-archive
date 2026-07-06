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
apps/api         Node 20 + Express — auth (JWT+RBAC), recordings, search, Stripe,
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

Full specification: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Decisions:
[`docs/DECISIONS.md`](docs/DECISIONS.md). Build plan: [`docs/SESSION_PLAN.md`](docs/SESSION_PLAN.md).

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

`npm run doctor` probes env completeness, Postgres schema + pgvector, Mongo +
indexes, Redis, R2, the AI service, and Stripe — a ✓/△/✗ readiness report whose
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
production cutover and public beta — is specified in
[`docs/SESSION_PLAN.md`](docs/SESSION_PLAN.md) and in progress.

## License & contact

All recordings remain under the rights of their communities and performers;
see `docs/DATASET_STRATEGY.md` for the governance and licensing model.
Code license: TBD before public release.

Khalid Ibrahim · Somali Music AI Preservation Platform · Minneapolis, MN

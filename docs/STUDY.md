# Listening study (`/study`)

A 10-minute blind paired comparison for musicians who know Somali music. Built 2026-10-31.

## What a participant does
Background questions (how they know Somali music, instrument, years, familiarity with qaraami
and heello 1–5, how they are listening, consent), then 13 pairs: four from each comparison
below plus one attention check (a clip against itself). For each pair: which sounds more like
Somali music (A / B / about the same / neither sounds Somali) and which sounds better as a
recording (A / B / about the same). Answers unlock after both clips played at least 3 s. English
and Somali (the Somali text is a draft for Khalid to check). Progress survives a reload.
Anonymous: no name, email, IP address or user agent is stored.

| comparison | pairs | base | adapter | clip length |
| --- | --- | --- | --- | --- |
| `oud` | 8 | MusicGen small | `oud` | 10 s |
| `cleanoud` | 16 | ACE-Step 1.5 xl-sft | `ace_clean_oud` | first 20 s |
| `songs` | 16 | ACE-Step 1.5 xl-sft | `ace_songs_v4` (Somali lyrics) | first 20 s |

Only releasable models (model cards, rights gate); Harvard-trained adapters are excluded. Clips
are loudness-matched (EBU R128 -16 LUFS, measured within about 1 LU) and opaquely named.

## Files
- `apps/ai-service/scripts/study_prepare.py` — clips, `apps/web/lib/study/stimuli.json`,
  `apps/ai-service/study/key.json` (id → condition), rights-manifest entries.
- `apps/web/lib/study/` — session design and Zod schema, text, storage.
- `apps/web/app/api/study/route.ts` — POST, Zod-validated, 64 KB cap.
- `apps/web/components/study/ListeningStudy.tsx`, `apps/web/app/study/page.tsx` (not indexed).
- `apps/ai-service/scripts/study_analyze.py` — report `docs/eval/LISTENING_STUDY.md`.

## Turning on storage (once, Khalid)
Vercel → project → **Storage** → **Create Database** → **Upstash for Redis** (free plan) →
connect it to this project for Production (and Preview). Vercel adds `KV_REST_API_URL` and
`KV_REST_API_TOKEN`; redeploy. Until then the page works but cannot save, and offers each
participant a download of their answers. Locally (`npm run dev`) answers go to
`apps/web/.study-responses.local.jsonl` (git-ignored).

## Results
Copy the two variables from Vercel → Storage → the store → `.env.local` tab, then:

    KV_REST_API_URL=... KV_REST_API_TOKEN=... uv run --with numpy python \
        apps/ai-service/scripts/study_analyze.py --redis --out docs/eval/LISTENING_STUDY.md

## Verified 2026-10-31
Unit tests for design, schema and storage; a full run in headless Chrome at 390 px on the dev
server (background form, 13 pairs with the clips actually playing, answers locked until both
played, saved response with 13 answers and no request metadata); the analysis matched a hand
count on that response, and the attention check excluded the bot that picked a side.

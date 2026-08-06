# Audio inventory — B1-14 (read-only report)

Generated 2026-08-06 by enumerating (1) audio files in the repository working
tree, (2) every object in the R2 bucket, (3) every recording referenced in
MongoDB, and (4) the listening-room track list (`apps/web/lib/tracks.ts`).
**No audio was added, removed, or modified.** ⚠ marks rows whose source or
rights are unverified. Nothing enters the listening room without Khalid's
explicit selection.

## Individually referenced assets

| # | Filename / key | Title | Performer | Instruments | Duration | Format | Source | Rights | Transcription? | In listening room? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `public/audio/track_0241.mp3` | In la i talinaayo | From the play “Allah aammin ma iisho” | ensemble | 5:42 | mp3 44.1k/320k | Harvard Loeb corpus (staged; gitignored; deploy script re-attaches) | ⚠ unverified | no | yes |
| 2 | `public/audio/track_0249.mp3` | Yaxaas | Maxamed Axmed Kuluc and ensemble | ensemble | 7:02 | mp3 44.1k/320k | Harvard Loeb corpus | ⚠ unverified | no | yes |
| 3 | `public/audio/track_0253.mp3` | Illoow Illoow | Maxamed Axmed Kuluc and ensemble | ensemble | 7:46 | mp3 44.1k/320k | Harvard Loeb corpus | ⚠ unverified | no | yes |
| 4 | `public/audio/track_0300.mp3` | Tolow yaa nakala guri | Qalinle, Sado Ali & Marwo Mohamed | ensemble | 7:44 | mp3 44.1k/320k | Harvard Loeb corpus | ⚠ unverified | no | yes |
| 5 | `public/audio/track_0301.mp3` | Dhidibsaan ku leeyahay | Qalinle, Sado Ali & Marwo Mohamed | ensemble | 7:06 | mp3 44.1k/320k | Harvard Loeb corpus | ⚠ unverified | no | yes |
| 6 | `public/audio/track_0302.mp3` | Samsamay | Qalinle, Sado Ali & Marwo Mohamed | ensemble | 4:04 | mp3 44.1k/320k | Harvard Loeb corpus | ⚠ unverified | no | yes |
| 7 | `public/audio/track_0311.mp3` | Qaahira | Axmadey Abubakr | ensemble | 6:50 | mp3 44.1k/320k | Harvard Loeb corpus | ⚠ unverified | no | yes |
| 8 | `public/audio/track_0360.mp3` | Goormaan ladnaannay | Heesaha Calanka — Songs for the Flag of Independence | ensemble | 6:14 | mp3 44.1k/320k | Harvard Loeb corpus | ⚠ unverified | no | yes |
| 9 | `public/demos/audio/mixture.mp3` | (research demo — full mix) | unknown | ensemble | 5:52 | mp3 48k/128k | Corpus item, separation demo input — **not** one of rows 1–8 (md5 checked) | ⚠ unverified | no | no |
| 10 | `public/demos/audio/vocals.mp3` | (research demo — vocals stem) | unknown | voice | 5:52 | mp3 44.1k/128k | Derived from row 9 by source separation | ⚠ unverified | no | no |
| 11 | `public/demos/audio/bass.mp3` | (research demo — bass stem) | unknown | bass | 5:52 | mp3 44.1k/128k | Derived from row 9 | ⚠ unverified | no | no |
| 12 | `public/demos/audio/drums.mp3` | (research demo — drums stem) | unknown | percussion | 5:52 | mp3 44.1k/128k | Derived from row 9 | ⚠ unverified | no | no |
| 13 | `public/demos/audio/other.mp3` | (research demo — other stem) | unknown | other | 5:52 | mp3 44.1k/128k | Derived from row 9 | ⚠ unverified | no | no |
| 14 | `public/sample/audio.mp3` (+ identical copy bundled at `apps/mobile/assets/sample/audio.mp3`) | Sample session — voice | synthesized | synthetic voice-like | 5:49 | mp3 22.05k/64k | **Synthesized from the pipeline's note list** (no archival audio) — source recording was corpus item `96b787e9…`, not rows 1–8; only derived data deploys | owned (synthesis) | **yes** — 412 notes, mean confidence 0.68 | no |
| 15 | `public/sample/hero-audio.mp3` | Qaraami phrase in A pentatonic (hero excerpt) | synthesized | plucked-string synthesis | 0:17 | mp3 22.05k/64k | **Synthesized from `fixtures/hero-excerpt.mei`** (hand-curated placeholder pending Khalid's own oud recording) | owned (synthesis) | yes — hand edition | no (landing hero) |
| 16 | R2 `generated/0e/0eea6fbf….mp3` | (untitled generation output) | AI-generated | instrumental | 0:31 | mp3 44.1k/194k | Generation layer output (Lyria-shaped 30s clip from Aug testing) | ⚠ per provider terms — verify | no | no |
| 17 | Mongo `recordings/seed/81d1f73d….wav` | Kaana Siib Kaana Saar | “Ahmed Ali Egal” (seed fixture) | — | — | — | Seed metadata; **object missing in R2** (dangling reference) | ⚠ fixture | no | no |
| 18 | Mongo `recordings/seed/f8f05a94….wav` | Balwo Hobalka | seed fixture | — | — | — | Seed metadata; object missing in R2 | ⚠ fixture | no | no |
| 19 | Mongo `recordings/seed/becb9688….wav` | Hooyo Macaan | seed fixture | — | — | — | Seed metadata; object missing in R2 | ⚠ fixture | no | no |
| 20 | Mongo `recordings/seed/d81dc9aa….wav` | Dhulkayaga | seed fixture | — | — | — | Seed metadata; object missing in R2 | ⚠ fixture | no | no |
| 21 | Mongo `recordings/seed/1ea55204….wav` | Jacayl Dhiig Ma Lagu Qoray | seed fixture | — | — | — | Seed metadata; object missing in R2 | ⚠ fixture | no | no |

## Bulk pipeline artifacts (aggregate — regenerable, gitignored, never deployed)

| Location | Count | What | Source / rights |
|---|---|---|---|
| `data/clips/` | 11,386 wav clips | MusicGen training segments | ⚠ corpus-derived, unverified |
| `data/eval_gen/` | 300 wav | model evaluation outputs | AI-generated from corpus-trained model ⚠ |
| `runs/` | 29 wav | training run samples | AI-generated ⚠ |

## Findings for review

1. **Every playable row except 14–15 is rights-unverified.** The eight
   listening-room tracks are corpus staging with `license_status=unknown`
   (their own README says the canonical copies live at Harvard; each row
   carries its `sourceUrl`).
2. **Rows 17–21 are dangling:** Mongo references five seed WAVs that do not
   exist in R2 (`recordings/seed/*` was never uploaded). Any UI that trusts
   these records will render unplayable tracks.
3. The **demo stems (rows 9–13)** are separation outputs of a corpus item and
   are publicly served at `/demos/` on the deployed site today.
4. The only owned-outright audio in the entire project is synthesized
   (rows 14–16 with 16 pending a provider-terms check).

**Stopped here per B1-14.** Khalid selects which tracks enter the listening
room; nothing is added, removed, or re-flagged without his explicit decision.

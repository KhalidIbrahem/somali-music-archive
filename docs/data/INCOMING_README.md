# `data/incoming/` — contributor drop-offs

This folder is where a contributor's recordings land before they enter the
corpus. One sub-folder per contributor, holding the audio (any layout, any of
`.wav .aif .aiff .flac .m4a .mp3 .ogg .aac .caf`, the extensions
`scripts/ahmed_extract.py` walks) and one plain-text record named
`CONTRIBUTOR.md`. `scripts/intake.py` (run by the orchestrator at every start)
reads the record, inventories the audio, stamps every file with the rights
tier the record grants, dedupes it against the corpus and writes
`data/inventory/contrib_<slug>_files.jsonl`. **A folder without a valid record
is skipped and the reason is logged** in `data/inventory/intake_log.jsonl`;
nothing from it is inventoried, trained on or published.

The folder is git-ignored (`data/incoming/`): audio never enters the
repository. The inventories are JSON and stay tracked.

```
data/incoming/
└── Faadumo Qaasim/            ← folder name becomes the slug faadumo_qaasim
    ├── CONTRIBUTOR.md         ← the record below (required)
    ├── qaraami_1.wav
    └── session 2/             ← sub-folders are fine (recorded as `project`)
        └── qaraami_2.wav
```

The slug is the folder name lower-cased with everything but `[a-z0-9]` turned
into `_`, so `Faadumo Qaasim` and `faadumo-qaasim` would be the same
contributor: the second such folder is skipped (reason `slug 'faadumo_qaasim'
already used by ...`) until it is renamed. Give every contributor a distinct
folder name.

## The record: `CONTRIBUTOR.md`

Plain `key: value` lines (Markdown bullets and bold keys are accepted; a UTF-8
BOM and Windows line ends are fine). The four keys marked required must be
present or the folder is skipped:

| key | required | meaning |
| --- | --- | --- |
| `name:` | yes | the name the contributor wants to be credited under in captions, model cards and papers (or "not named") |
| `date:` | yes | the date the record was signed, `YYYY-MM-DD` |
| `gave:` | no | what they handed over, in their words (how many recordings, what is on them, who plays) |
| `uses:` | no | the uses granted, comma-separated, from the list below; anything not listed is *not* granted |
| `tier:` | yes | `consented_publishable` or `research_only` (see below) |
| `signed_by:` | yes | who signed, and where the original is held (never a path to a shared drive) |

Accepted alternative spellings: `credited_as:` / `credit:` / `contributor:` for
`name:`, `signed:` for `signed_by:`, `what:` / `recordings:` for `gave:`,
`uses_granted:` for `uses:`. The canonical key always wins: if a record has both
a `contributor:` line and a `name:` line, `name:` is the credited name.

Uses (each said separately in the signed document so any can be declined; the
list mirrors item 3 of [`docs/data/consent/README.md`](consent/README.md)):

`analyse` (transcription, pitch, embeddings) · `train` (fine-tune models on the
recordings) · `evaluate` (score those models) · `publish_adapters` (release the
trained weights) · `publish_outputs` (generated audio in papers, demos, the
website) · `quote_excerpts` (short excerpts in research writing and listening
studies) · `keep_for_project` (keep the recordings on the project's machines for
the life of the project).

Tiers and what the intake stamps on every file:

| `tier:` in the record | `rights` on every inventory row | means |
| --- | --- | --- |
| `consented_publishable` | `contrib_<slug>_consented` | train + publish (adapters and outputs), attribution as in `name:` |
| `research_only` | `contrib_<slug>_research_only` | train research adapters and evaluate; never served, never published |

The tier is what every downstream script reads (`build_sets.py`,
`model_report.py`), so when the record lists `uses:` they must cover it, or the
folder is skipped with the reason logged: `research_only` needs `train`;
`consented_publishable` needs `train`, `publish_adapters` and `publish_outputs`.
A record granting `analyse` only cannot carry either tier; such recordings stay
out of the corpus until the signed document grants training.

Example:

```
# Contributor record

name: Faadumo Qaasim
date: 2026-09-20
gave: 3 home recordings of qaraami songs (oud and voice), recorded 2019 in Minneapolis
uses: analyse, train, evaluate, publish_adapters, publish_outputs
tier: consented_publishable
signed_by: Faadumo Qaasim; paper original held by Khalid Ibrahim, scan in private storage
```

## What never goes in the folder

No scan or photograph of the signed document, no identity detail (ID number,
phone, postal address, date of birth). The signed original stays in Khalid
Ibrahim's private storage; the record here is the text index of it, the same
rule as `docs/data/consent/README.md`. After intake, add the contributor's
line to the index table in that README.

## What the intake does with the folder

1. Parses the record; a missing or malformed required line skips the folder
   (`intake_log.jsonl` says why; fix the record and the next run picks it up).
2. Inventories every audio file with `scripts/ahmed_extract` (ffprobe facts, full
   sha256, silence fraction; duplicates inside the folder are marked
   `duplicate`), source group `contrib_<slug>`, role `song`. The Ahmed-specific
   `apple_loop` rule (every `.caf`, Apple-loop-looking names) is lifted for
   contributor files: a `.caf` voice memo counts like any other recording.
3. Marks files the corpus already holds — same sha256 as a row of
   `ahmed_files.jsonl`, the Harvard manifest, the internet manifest or another
   contributor's inventory — `excluded` with reason `duplicate_of_corpus`.
4. Writes `data/inventory/contrib_<slug>_files.jsonl` (ahmed_files schema plus
   `rights`, `contributor`, `consent_record`, `consent_date`, `consent_tier`,
   `uses_granted`, `dup_of_corpus`) so `ahmed_classify.py --inventory` and
   `build_sets.py` can consume it, and appends one line to `intake_log.jsonl`.
5. Is idempotent: a folder whose record and files did not change is left alone
   ("no new contributors"); adding a file or fixing the record re-runs it, and
   already-measured files are reused. A `--limit N` smoke pass is logged with
   status `partial` and never counts as final: the next full run inventories the
   whole folder (only another smoke run with the same limit sees it as unchanged).

Run by hand from `apps/ai-service`:

```
python -m scripts.intake                 # data/incoming, writes inventories
python -m scripts.intake --dry-run       # parse and walk, write nothing
python -m scripts.intake --limit 5       # smoke: first 5 files per contributor (partial; the next full run redoes it)
```

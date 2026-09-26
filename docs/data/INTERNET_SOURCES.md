# Internet sources — rights-permitting acquisition

Generated 2026-09-26T06:14:35+00:00 by `scripts/internet_acquire.py --report`. Data: `data/internet/manifest.jsonl`, `skipped.jsonl`, `candidates.jsonl`, `runs.jsonl` (audio and its sidecars are git-ignored).

## Policy

Only material whose licence is explicit and permits reuse is downloaded: Internet Archive items whose `licenseurl` is CC BY or CC BY-SA, CC0 or the Public Domain Mark, or whose rights text says public domain, CC0 or CC BY with no negation or reservation in it ("Not in the public domain" and "all rights reserved" fail closed); YouTube videos whose licence field reads "Creative Commons Attribution license (reuse allowed)"; hand-added URLs only with a rights note, the tier `internet_cc` and a `licence_url` or `licence_text` that passes the same rules (contributor tiers are never downloadable here: consented audio goes through `data/incoming/` and `scripts/intake.py`). Everything else is logged with its reason and not fetched. Downloads carry the tier `internet_cc` (train + publish, attribution recorded in the sidecar and the manifest). `internet_research_only` is never downloaded: the tier exists so the manifest can name the policy, not so the corpus can grow around it. Requests are spaced by at least 5 s and downloads by at least 10 s (the latest run row's --request-gap/--download-gap, else the script defaults), 429/5xx answers are retried with back-off, and every run is capped per source and by total hours; items already downloaded or already decided are not re-evaluated. Caveat: a YouTube "Creative Commons Attribution" flag is the uploader's declaration, not proof of ownership. Uploads of classic recordings by third-party channels (a private channel posting a Xasan Aadan Samatar song, say) are downloaded under `internet_cc` because the declared licence permits it, but before any adapter trained on them is published each such item must be reviewed by hand and, where the uploader plainly does not hold the rights, its `tier` in `data/internet/manifest.jsonl` set to `internet_research_only` and `--inventory` re-run (the inventory then carries that tier and build_sets keeps it out of publishable sets; a blank or misspelled tier makes the inventory row research-only and excluded).

## Summary

| source | queries | candidates seen | rights-permitting | downloaded items | files | hours | pending (not downloaded) | skipped |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ia | 12 | 15 | 0 | 0 | 0 | 0.00 | 0 | 15 |
| yt | 15 | 18 | 3 | 3 | 3 | 0.40 | 0 | 15 |
| file | 1 | 0 | 0 | 0 | 0 | 0.00 | 0 | 0 |

Total downloaded: 3 items, 0.40 h of non-excluded audio; `data/inventory/internet_files.jsonl` holds 3 rows.

## Internet Archive

Queries:

- `somali AND mediatype:audio`
- `qaraami AND mediatype:audio`
- `somali oud AND mediatype:audio`
- `kaban somali AND mediatype:audio`
- `somali music 1960s AND mediatype:audio`
- `hees somali AND mediatype:audio`
- `Radio Hargeisa AND mediatype:audio`
- `Radio Mogadishu AND mediatype:audio`
- `somali traditional song AND mediatype:audio`
- `balwo AND mediatype:audio`
- `heello somali AND mediatype:audio`
- `dhaanto AND mediatype:audio`

### Downloaded (0)

None.

### Rights-permitting, not downloaded (0)

None.

### Skipped (15)

| reason | count |
| --- | --- |
| no licence metadata | 15 |

Examples (licence text as read from the source):

- `3565683568536855853685682016_201701` — ayat quran Program with teacher voice and translation into 27 language — licence: (none)  → no licence metadata

## YouTube

Queries:

- `qaraami`
- `kaban`
- `somali oud`
- `heesta qaraami`
- `balwo`
- `heello`
- `dhaanto`
- `Somali music 1970s`
- `Somali oud solo`
- `Maxamed Suleebaan`
- `Xasan Aadan Samatar`
- `Maxamed Mooge Liibaan`
- `Axmed Cali Cigaal`
- `Hibo Maxamed`
- `Maryan Mursal`

Search mode: YouTube's own "Creative Commons" results filter (`sp=EgIwAQ==`) is used as a pre-filter unless a run passed `--no-yt-cc-filter`; the decision for every video is still its `license` field read with yt-dlp (`Creative Commons Attribution license (reuse allowed)` accepted; `Standard YouTube License` or no field rejected).

### Downloaded (3)

| item | title | creator | licence | URL | hours | files | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `MtY0Zgeqxbc` | Xaliima Kh Magool Kalah Banaadiri | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=MtY0Zgeqxbc | 0.179 | 1 |  |
| `p9E1zSMu3Os` | XASAN AADAN SAMATAR \| BALADWEYN \| HEES QARAAMI AH BILAA MUSIC AH | M. Abshir | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=p9E1zSMu3Os | 0.119 | 1 |  |
| `ulj4XkvQPyc` | ISMAACIIL DULCAD HEESTA DEGAN QARAAMI  OFFICIAL VIDEO 2018 HORN CABLE TV | Horn Cable Tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ulj4XkvQPyc | 0.105 | 1 |  |

### Rights-permitting, not downloaded (0)

None.

### Skipped (15)

| reason | count |
| --- | --- |
| no licence field | 15 |

Examples (licence text as read from the source):

- `2e5ogbwRBUU` — Cumar Dhuule Heestii _ Koley Caashaqaygii _ Hees Qaraami Xul ah With L — licence: (none)  → no licence field

## Hand-added URLs (--sources-file)

Queries:

- `--sources-file rows`

### Downloaded (0)

None.

### Rights-permitting, not downloaded (0)

None.

### Skipped (0)

None.

## Dedupe

- Exact sha256 duplicates of the corpus (excluded): 0
- Near-duplicates of Ahmed's corpus (MERT last-layer cosine >= 0.97, excluded): 0
- Possible Harvard duplicates by title (logged, kept): 0
- Nearest-Ahmed cosine over 3 downloaded files: min 0.895, median 0.914, max 0.940


## Runs

| when | sources | search-only | limit | gaps (s) | candidates | downloaded | pending | skipped | cached | waits | elapsed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-26T05:41:23+00:00 | ia yt | True | 15 | ?/? | 30 | 0 | 0 | 30 | 0 | 17 | 89.7 s |
| 2026-09-26T05:45:37+00:00 | yt | False | 3 | ?/? | 3 | 3 | 0 | 0 | 0 | 7 | 37.0 s |

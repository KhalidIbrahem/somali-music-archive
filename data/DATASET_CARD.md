# Dataset Card: SomaliMusicCorpus-HAR-v1

## Dataset Summary

**SomaliMusicCorpus-HAR-v1** is the first labeled dataset of traditional Somali
music for music information retrieval. It derives from the **Maryan "Aryette"
Omar Ali Collection** (Harvard Archive of World Music, Loeb Music Library,
**AWM Spec Coll 103** — *Somali Songs, 1955–1991*): 605 digitised cassette
tracks (from 974 catalog entries) of *heello*, *qaraami*, theatre and praise
songs performed by Magool, Faduumo Qaasim, Sahra Axmed, Cumar Dhuule,
Maxamed Suleebaan, Xasan Aadan Samatar and others, with *oud* (*kaban*),
organ, guitar, violin, clarinet, saxophone and frame drums.

Each record carries catalog metadata (title, performers, cassette/side,
recording date where recoverable), audio-quality audit fields, Somali + English
transcripts (Whisper large-v3, with an explicit sung/unreliable flag),
frame-level pitch mapped to a Somali pentatonic reference with **microtonal
deviation in cents**, ornament statistics, genre labels/predictions, and
MERT-v1-95M embeddings. Records validate against
`apps/ai-service/data/schema/dataset_schema.json`.

- **Curated by:** Somali Music Preservation Foundation (Khalid Ibrahim), Minneapolis, MN
- **Source archive:** Harvard Library, Archive of World Music
- **Languages:** Somali (`so`); English translations machine-generated
- **Modality:** audio-derived annotations; audio access governed separately (below)

## Supported Tasks

- Genre classification (*heello*, *qaraami*, *dhaanto*, praise song) — first Somali baseline
- Scale-degree classification (first for any East African tradition)
- Low-resource / sung-language ASR benchmarking (Somali)
- Microtonality and tuning-system analysis (per-degree cents distributions, 1955–1991 drift)
- Music similarity / retrieval over MERT embeddings

## Dataset Structure

Exports produced by `scripts/process_harvard.py assemble`:

| File | Contents |
|---|---|
| `somali_music_dataset_v1.json` | full records incl. artifact paths |
| `somali_music_dataset_v1.csv` | flattened for analysis |
| `somali_music_dataset_v1_lite.json` | no file paths — the sharing variant |
| `harvard_inventory.csv` | Phase A inventory (id, title, artists, duration, cassette, side, date, SHA-1, flags) |

Splits: deterministic per-track SHA-1 hash (≈80/20). Window-level splitting is
deliberately not offered — it leaks recording conditions.

## Licensing and Access

- **Catalog metadata:** CC BY 4.0 (Harvard Library).
- **Annotations in this dataset (transcripts, pitch data, embeddings, labels):**
  CC BY-NC 4.0, attribution "Somali Music Preservation Foundation /
  Maryan 'Aryette' Omar Ali Collection, Harvard AWM Spec Coll 103".
- **Audio:** NOT redistributed here. Research listening via Harvard Library;
  bulk research access by request through the Foundation, subject to the
  governance process below.
- Machine transcripts of **sung** segments are flagged unreliable — do not use
  them as lyric ground truth.

## Ethical Considerations and Governance

Stewarded under a Somali community-governance model aligned with the CARE
principles: a Cultural Advisory Board (elder musicians, ethnomusicologist,
legal advisor) reviews publication and any commercial use; licensing value
accrues to the community and performers' estates; the archive is
soft-delete-only; the enriched corpus is offered back to Somali institutions
without fee. Microtonal deviation from 12-TET is treated as signal, not error —
the dataset must not be used to "correct" Somali intonation toward Western
temperament.

## Citation

```bibtex
@inproceedings{ibrahim2026somalimusiccorpus,
  title     = {SomaliMusicCorpus: The First Labeled Dataset of Traditional
               Somali Music for Music Information Retrieval},
  author    = {Ibrahim, Khalid},
  booktitle = {Proc. of the International Society for Music Information
               Retrieval Conference (ISMIR)},
  year      = {2026},
  note      = {Derived from the Maryan "Aryette" Omar Ali Collection,
               Harvard Archive of World Music, AWM Spec Coll 103}
}
```

Please also credit **Maryan "Aryette" Omar Ali**, whose collecting made this
corpus possible, and Harvard's Archive of World Music for preservation and
digitisation.

## Known Limitations

- Consumer-cassette provenance: SNR ≈ 7–13 dB pre-enhancement on sampled tracks.
- Somali sung-text ASR is weak; sung transcripts are flagged, not trusted.
- Scale-degree training labels are machine-derived (CREPE + scale map) pending
  expert audit; treat reported accuracies accordingly.
- 369 catalog entries (974 − 605) have no retrieved audio in v1.

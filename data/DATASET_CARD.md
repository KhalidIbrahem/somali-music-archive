# Dataset Card: SomaliMusicCorpus-HAR-v1

## Dataset Summary

**SomaliMusicCorpus-HAR-v1** is, to our knowledge, the first labeled dataset
dedicated to Somali music for music information retrieval. (East African
precedents exist for Ethiopian music — see EMIR, Retta et al. 2023 — but none
for Somali music.) It derives from the **Maryan "Aryette" Omar Ali
Collection** (Harvard Archive of World Music, Eda Kuhn Loeb Music Library,
**AWM Spec Coll 103** — *Somali Songs, 1955–1991*, 504 audiocassettes,
974 track-level catalog entries): 605 digitized tracks of twentieth-century
Somali song — *heello*, *qaraami*, theatre and praise songs — performed by
Magool, Faduumo Qaasim, Sahra Axmed, Cumar Dhuule, Maxamed Suleebaan,
Xasan Aadan Samatar and others.

Each record carries catalog metadata (title, performers, cassette/side,
recording date where recoverable from catalog titles), audio-quality audit
fields, Somali + English transcripts (Whisper large-v3, with an explicit
sung/unreliable flag), frame-level pitch data with **per-track pentatonic
grid alignment** (invariant to key, cassette playback speed, and A440
assumptions), and MERT-v1-95M embeddings. Records validate against
`apps/ai-service/data/schema/dataset_schema.json`.

- **Curated by:** Somali Music Preservation Foundation **(Khalid Ibrahim)**, Minneapolis, MN
- **Source archive:** Harvard Library, Archive of World Music
- **Languages:** Somali (`so`); English translations machine-generated
- **Modality:** metadata + audio-derived annotations. **Audio is not part of this dataset** (see Licensing).

## Supported Tasks

- Intonation / tuning-system analysis on archival audio (aligned cents-deviation distributions; 1955–1991 diachronic comparison on date-stamped tracks)
- Genre classification (labels pending expert annotation — see Limitations)
- Scale-degree monitoring (reference model included; machine-distilled labels)
- Low-resource / sung-language ASR benchmarking (Somali)
- Music similarity / retrieval over MERT embeddings
- MIR robustness studies on real archival audio (median SNR ≈ 9.5 dB)

## Dataset Structure

Exports produced by `scripts/process_harvard.py assemble`:

| File | Contents |
|---|---|
| `somali_music_dataset_v1.json` | full records incl. local artifact paths |
| `somali_music_dataset_v1.csv` | flattened for analysis |
| `somali_music_dataset_v1_lite.json` | no file paths — the sharing variant |
| `somali_music_dataset_v1_huggingface/` | JSONL + this card (HF `datasets`-loadable) |
| `harvard_inventory.csv` | full inventory incl. the 369 catalog entries with no retrieved audio, so missingness is analyzable |
| `analysis/corpus_analysis.json` | every statistic quoted in the paper |

Splits: deterministic hash of the **cassette** (not the track — tracks on one
cassette share tape generation, deck, speed error, and noise floor; splitting
them across train/val leaks recording conditions).

## Licensing and Access

- **Catalog metadata:** CC BY 4.0 (Harvard Library).
- **Annotations in this dataset (transcripts, pitch data, embeddings, audits):**
  CC BY-NC 4.0, attribution "Somali Music Preservation Foundation /
  Maryan 'Aryette' Omar Ali Collection, Harvard AWM Spec Coll 103".
- **Audio:** NOT included and NOT redistributed. Audio was accessed from
  Harvard's public research-listening interface at catalog-listed URLs for
  research use; listening access is via Harvard Library, and we are pursuing
  a formal research-access understanding with Harvard for anything beyond
  that. **We claim no rights over the recordings and enable no commercial use
  of them.**
- Machine transcripts of **sung** segments are flagged unreliable — do not use
  them as lyric ground truth.

## Ethical Considerations and Governance

Stewarded under a Somali community-governance model aligned with the CARE
principles: a Cultural Advisory Board (elder musicians, ethnomusicologist,
legal advisor) reviews releases; the enriched corpus is offered without fee
to Somali institutions, including the Redsea Cultural Foundation (Hargeysa),
whose *qaraami* documentation (Jama Musse Jama, 2023) this dataset is
designed to complement. Deviation from 12-TET is treated as signal, not
error — the dataset must not be used to "correct" Somali intonation toward
Western temperament. Benefit-sharing commitments concern the Foundation's
separate consented field-recording program with living musicians, not the
Harvard material.

## Citation

```bibtex
@misc{ibrahim2026somalimusiccorpus,
  title  = {SomaliMusicCorpus: A Labeled Dataset of Twentieth-Century
            Somali Song for Music Information Retrieval},
  author = {Ibrahim, Khalid},
  year   = {2026},
  note   = {Derived from the Maryan "Aryette" Omar Ali Collection,
            Harvard Archive of World Music, AWM Spec Coll 103.
            Draft under review.}
}
```

Please also credit **Maryan "Aryette" Omar Ali**, whose collecting made this
corpus possible, and Harvard's Archive of World Music for preservation and
digitisation.

## Known Limitations

- Consumer-cassette provenance: median SNR ≈ 9.5 dB (dev subset); 7 tracks clipped.
- 369 of 974 catalog entries (38%) have no retrieved audio in v1; the inventory
  ships so missingness can be analyzed.
- Genre labels await expert annotation; no genre accuracy is claimed yet.
- Scale-degree training labels are machine-derived (CREPE + scale map);
  evaluation against them measures agreement, not ground-truth accuracy.
- Pitch analysis (dev subset) runs on full mixes (predominant f0), gated at
  0.80 confidence (median 20% frame retention — a selection toward sustained
  tones); ornament event counts are exploratory artifacts of that gate.
- Per-degree microtonal profiles are deferred pending stem separation and
  mode disambiguation; released headline statistics are rotation-invariant
  track-level dispersions.

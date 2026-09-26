# Caption style guide — template v2

Captions are written by `apps/ai-service/scripts/build_sets.py` (`build_caption`,
`CAPTION_VERSION = 2`). Every clip of a set carries one caption; the caption is
the text condition the MusicGen adapters train on, so it must say only what the
data supports. Rows built with another version are re-captioned from the clips
already on disk (read back, described again, never decoded or rewritten); only a
missing, truncated or differently windowed clip makes the builder re-cut a source.

## Field order

```
<genre>, Somali traditional song, led by <instruments>, <tempo-word> at <N> BPM,
pentatonic melody rooted on <tonic>[, tuned <k> cents flat|sharp of A440],
<recording tag>[, performed by <performer>]
```

| # | Field | Source | Rule |
| --- | --- | --- | --- |
| 1 | `<genre>` | first genre word by position in the project/bundle name, then the file name (Harvard: catalog title, then cassette title) | mapped to a canonical word (below); without one the set default: `qaraami` for `ahmed_oud`, `Somali song` for every other set |
| 2 | `Somali traditional song` | fixed | dropped when the genre is the fallback `Somali song` (the caption then starts `Somali song, led by ...`) |
| 3 | `led by <instruments>` | the set's content label, `percussive_ratio` of the source row, an optional classifier `instruments` list | see the instrument vocabulary; stems name only what Demucs left in them |
| 4 | `<tempo-word> at <N> BPM` | `build_scale_dataset.tempo_bpm` on the clip | `slow` < 80, `moderate` 80–120, `lively` > 120; `N` rounded |
| 5 | `pentatonic melody rooted on <tonic>` | `scripts.pcs.score_frames` on every clip (CREPE f0, pentatonic correlator), then **one answer per song** (`song_consensus`, below); fallback `pentatonic.detect_from_audio` when no clip of the song scored | pitch-class name `C … B`; the row records `tonic_source` = `scorer` (this clip scored), `song` (this clip did not, the song's consensus is used) or `histogram` (no clip of the song scored) |
| 6 | `tuned <k> cents flat|sharp of A440` | the song consensus offset | only when the song has a scored clip **and** \|offset\| ≥ 15 cents; `k` = rounded absolute offset, negative = flat; the offset the caption uses is on the row whatever its size, the clip's own raw reading beside it |
| 7 | `<recording tag>` | the rights tier (and, for internet rows, the year) | see below |
| 8 | `performed by <performer>` | the tier / the row | `Ahmed Ilkacase` for `ahmed_ilkacase_consented`; the row's own `performer` (or `artist`) field for generic sets; never for Harvard |

Separator: `, ` between fields; no trailing period.

### One tonic and one tuning claim per song

`pentatonic.tuning_offset` returns an offset in [-50, 50), so a recording about
a quarter-tone off A440 reads `C#, 46 cents sharp` on one clip and `D, 48 cents
flat` on the next: the same pitch, two contradictory captions. `build_sets` therefore
decides tonic and tuning once per source: every scored clip votes with its
absolute tonic pitch (pitch class × 100 + offset, mod 1200, on which those two
readings are 4 cents apart), the largest cluster of readings within 60 cents
wins (ties: the lowest pitch; a fifth-related ambiguity such as D on 11 clips
and A on 4 resolves to the majority, not the mean), and its circular mean is
written as the nearest pitch class plus an offset in [-50, 50]. Every clip of the
song then says the same tonic and the same direction. A clip the scorer could
not score (too few voiced frames) takes the song's answer (`tonic_source`
`song`); a song without any scored clip keeps the per-clip histogram tonic and
claims no tuning.

## Vocabulary

Genre words (canonical → what matches; matching is case-insensitive, at a word
start, and a matched stem may carry a Somali suffix):

| canonical | spellings and definite forms |
| --- | --- |
| `qaraami` | qaraami, qarami, Qaraamiga |
| `balwo` | balwo, Balwada, Balwadii |
| `heello` | heello, heelo, Heellada, Heelada; `heele` / `hele` as whole words only (so the interjection *Heeleelooy* is not a genre) |
| `dhaanto` | dhaanto, dhanto, Dhaantada, Dhantada |
| `buraanbur` | buraanbur, Buraanburka |
| `shanto` | shanto, Shantada |

`shan` (five) alone never matches.

Instruments (by content label; the `instruments` list of a classified row
overrides the default for non-stem content):

| content | phrase |
| --- | --- |
| `oud` | `the oud (kaban)` |
| `voice` | `vocals` |
| `full_mix` | `vocals, the oud (kaban) and hand drums` |
| Harvard `full_mix` | `vocals and ensemble`, or `vocals and the oud (kaban)` when the catalog title names the oud (kaban / oud / cuud / kabanle) |
| `sep_oud` | `the oud (kaban)` — never `hand drums`, Demucs removed them; the mix's instrument list is ignored |
| `sep_vocal` | `vocals (unaccompanied)` |

`and hand drums` is appended to a non-stem, non-Harvard clip whose source row has
`percussive_ratio ≥ 0.35` (Harvard rows carry no classifier features, and
`build_caption` ignores the percussive rule on that tier). Several instruments
join as `a, b and c`.

Tempo words: `slow`, `moderate`, `lively`. Tonic names: `C, C#, D, D#, E, F, F#,
G, G#, A, A#, B`.

Recording tags by rights tier:

| rights | tag |
| --- | --- |
| `ahmed_ilkacase_consented` (ahmed_*, sep_oud, sep_vocal) | `studio recording, clean` |
| `harvard_research_only` (harvard_full, harvard_sep_*) | `vintage cassette, 1955–1991` |
| `internet_cc`, year < 2000 or no year | `archival recording` |
| `internet_cc`, year ≥ 2000 | `studio recording` |
| `contrib_<name>_consented`, `contrib_<name>_research_only` | `studio recording, clean` (the tag describes the audio; the set card states consented or research-only by the suffix) |
| any other tier | `archival recording` |

The year of an internet row is the first 1800–2099 number in its `year`,
`date`, `release_date`, `upload_date` (YYYYMMDD accepted), `recorded` or
`recording_date` field, also under `metadata`.

## One example per set

- `ahmed_oud` — `qaraami, Somali traditional song, led by the oud (kaban) and hand drums, moderate at 100 BPM, pentatonic melody rooted on A, studio recording, clean, performed by Ahmed Ilkacase`
- `ahmed_mix` — `balwo, Somali traditional song, led by vocals, the oud (kaban) and hand drums, moderate at 96 BPM, pentatonic melody rooted on C, tuned 18 cents flat of A440, studio recording, clean, performed by Ahmed Ilkacase`
- `ahmed_vocal` — `Somali song, led by vocals, lively at 130 BPM, pentatonic melody rooted on G, studio recording, clean, performed by Ahmed Ilkacase`
- `harvard_full` (title names the kaban) — `qaraami, Somali traditional song, led by vocals and the oud (kaban), moderate at 96 BPM, pentatonic melody rooted on D, vintage cassette, 1955–1991`
- `harvard_full` (no genre word, no instrument in the title) — `Somali song, led by vocals and ensemble, lively at 121 BPM, pentatonic melody rooted on E, vintage cassette, 1955–1991`
- `sep_oud` — `Somali song, led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, studio recording, clean, performed by Ahmed Ilkacase`
- `sep_vocal` — `qaraami, Somali traditional song, led by vocals (unaccompanied), moderate at 88 BPM, pentatonic melody rooted on G, tuned 17 cents sharp of A440, studio recording, clean, performed by Ahmed Ilkacase`
- `harvard_sep_oud` — `dhaanto, Somali traditional song, led by the oud (kaban), lively at 130 BPM, pentatonic melody rooted on E, tuned 20 cents flat of A440, vintage cassette, 1955–1991`
- `harvard_sep_vocal` — `Somali song, led by vocals (unaccompanied), slow at 72 BPM, pentatonic melody rooted on D, vintage cassette, 1955–1991`
- `<prefix>_oud` (internet_cc, 1978, performer on the row) — `qaraami, Somali traditional song, led by the oud (kaban) and hand drums, moderate at 100 BPM, pentatonic melody rooted on A, archival recording, performed by Cabdi Holland`
- `<prefix>_mix` (internet_cc, 2015, no performer) — `heello, Somali traditional song, led by vocals, the oud (kaban) and hand drums, moderate at 100 BPM, pentatonic melody rooted on A, studio recording`
- `<prefix>_vocal` (contrib_hodan_consented) — `Somali song, led by vocals, moderate at 100 BPM, pentatonic melody rooted on A, studio recording, clean`

A `--dry-run` prints the template with placeholders (`<tempo-word> at <N> BPM`,
`rooted on <tonic>`) and never a tuning tag.

## What is never claimed

- A genre without a genre word in the source's own name or catalog title. The
  only default genre is `qaraami` for `ahmed_oud` (the collection is qaraami);
  every other set, including the stems of Ahmed's mixes, falls back to
  `Somali song` and drops `Somali traditional song`.
- A performer for Harvard material, whatever the manifest, catalog or a row
  field says; nor does any Harvard row field name one (an unknown cassette is
  `AWM SC unknown (<cid>)`, never the cassette title).
- A performer for a generic set unless the row itself carries `performer` (or
  `artist`); `Ahmed Ilkacase` is spoken only for his tier.
- A performer for a `third_party_suspect` row admitted with
  `--include-third-party` (authorship unverified): the row keeps the tier of
  Ahmed's sessions, as `separate_stems` and `corpus_report` expect, but carries
  `third_party_suspect` and `third_party_reason`, and the set card counts such
  rows; a run trained on them should not be released.
- Two tonics or two tuning directions for one song: the song consensus above
  applies to every clip of the source, whichever side of the ±50 cents wrap each
  clip's own reading fell on (the raw reading stays on the row).
- Hand drums, or any other removed part, on a Demucs stem: `sep_oud` says
  `the oud (kaban)` alone, `sep_vocal` says `vocals (unaccompanied)`, even when
  the source mix was percussive or its classifier listed drums.
- Instruments the Harvard catalog does not support: the oud only when the
  title names it; otherwise `vocals and ensemble`.
- A tuning offset the scorer did not measure (histogram fallback, `--no-scorer`,
  a scorer error) or one under 15 cents; the tag is never derived from the
  histogram tonic.
- A year, a region or a tape-side for Ahmed's studio material; `1955–1991` is
  spoken only on the Harvard tier.
- Anything about rights or licences inside the caption: the tier lives in the
  row's `rights` field and the set card, not in the text the model reads.

## Row fields that document the caption

Each caption row carries `caption_version` (2), `tonic` (the pitch class the
caption names), `tuning_offset_cents` (float or null: the song consensus offset
the caption uses, whether or not a tag was spoken), `tonic_source` (`scorer` |
`song` | `histogram`), `clip_tonic` and `clip_tuning_offset_cents` (this clip's
own raw reading, null offset when the scorer did not score it), `content`,
`rights`, for stems `stem` (`other` | `vocals`) and `mix_path`, and for admitted
third-party suspects `third_party_suspect` (true) and `third_party_reason`.
`seconds` and the clip stem (`<set>[_<N>s]_<sha12>_segNNN`) name the window: only
30 s stems have no infix. A `chroma_dir` written by `scale_chroma --write-chroma-dir`
survives every resume, re-caption and same-window re-cut while its `.npy` exists.

## Version history

- v1 (2026-09-25): the eight-field template without tuning; Harvard tag
  `vintage cassette`; genres qaraami / balwo / heello / dhaanto / buraanbur.
- v2 (2026-09-26): optional tuning field from `scripts.pcs`; `shanto` and the
  Somali definite forms; Harvard tag `vintage cassette, 1955–1991`; recording
  tags for internet and contributor tiers; stem phrases for the Demucs sets;
  `tuning_offset_cents` and `tonic_source` on every row. Same day, after review:
  one tonic and one tuning claim per song (`song_consensus`), `tonic`,
  `clip_tonic` and `clip_tuning_offset_cents` on every row, the Harvard tier
  never speaks `hand drums`, no performer and a `third_party_suspect` flag for
  admitted suspect rows, and a version bump re-captions the clips on disk
  instead of re-cutting.

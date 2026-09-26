# Set card: ahmed_vocal

Built 2026-09-25T21:05:19-05:00 by `scripts/build_sets.py`.

- Rights: `ahmed_ilkacase_consented` — Ahmed Ilkacase's own sessions, consented for training; an adapter may be published, the audio may not.
- Source files this run: 211 of 211 selected (unique songs by sha256: 211, song groups: 42)
- Source audio: 5.87 h (manifest/inventory durations)
- Clips: 1075 × 30 s = 8.96 h (this run: 1075, kept from the previous build: 0)
- Clips per split: {"train": 836, "val": 195, "test": 44}
- Songs per split: {"train": 101, "val": 20, "test": 6}
- Content labels: {"voice": 211}
- Genres (caption): {"Somali song": 208, "qaraami": 3}
- Skipped at selection: {"collection_reserved_for_ahmed_oud": 20, "third_party_xml": 11, "third_party_mixed": 20, "content_drums": 69, "content_none": 91, "content_full_mix": 441, "third_party_import": 63, "content_oud": 17, "content_rap": 59, "content_synth": 1, "excluded": 342}
- Skipped at cut (decode errors, silent sources): {"silent_source": 2}
- Orphan clip files (no caption row): 0 (deleted: 0)
- Caption template version: 1

## Splits

Song-level 80/10/10 by `build_scale_dataset.song_splits` over the sorted (sha256-hashed) song-group keys of the
split universe (210 groups); every take, mixdown or variant of one song shares
the split. Leakage check: no song_sha256 and no song_group in two splits.

## Caption examples

- `train`: Somali song, led by vocals, lively at 139 BPM, pentatonic melody rooted on A, studio recording, clean, performed by Ahmed Ilkacase
- `val`: Somali song, led by vocals, lively at 188 BPM, pentatonic melody rooted on G, studio recording, clean, performed by Ahmed Ilkacase
- `test`: Somali song, led by vocals, lively at 125 BPM, pentatonic melody rooted on B, studio recording, clean, performed by Ahmed Ilkacase

## Notes

- Cut like `build_scale_dataset.py`: 30 s windows, 50 % overlap, peak-normalised to 0.99, clips 20 dB under the file RMS dropped, -14 LUFS; sources under -40 dBFS RMS skipped as silent.
- Resumable: sources whose clips and caption rows exist with the same window and caption version are reused; a song whose split moved has its clips renamed; a `--limit` run keeps the other sources' rows.

# Set card: ahmed_mix

Built 2026-09-25T21:04:20-05:00 by `scripts/build_sets.py`.

- Rights: `ahmed_ilkacase_consented` — Ahmed Ilkacase's own sessions, consented for training; an adapter may be published, the audio may not.
- Source files this run: 441 of 441 selected (unique songs by sha256: 441, song groups: 113)
- Source audio: 39.70 h (manifest/inventory durations)
- Clips: 8699 × 30 s = 72.49 h (this run: 8699, kept from the previous build: 0)
- Clips per split: {"train": 7452, "val": 596, "test": 651}
- Songs per split: {"train": 363, "val": 33, "test": 29}
- Content labels: {"full_mix": 441}
- Genres (caption): {"Somali song": 407, "dhaanto": 26, "balwo": 6, "qaraami": 2}
- Skipped at selection: {"collection_reserved_for_ahmed_oud": 20, "third_party_xml": 11, "third_party_mixed": 20, "content_drums": 69, "content_none": 91, "content_voice": 211, "third_party_import": 63, "content_oud": 17, "content_rap": 59, "content_synth": 1, "excluded": 342}
- Skipped at cut (decode errors, silent sources): {}
- Orphan clip files (no caption row): 0 (deleted: 0)
- Caption template version: 1

## Splits

Song-level 80/10/10 by `build_scale_dataset.song_splits` over the sorted (sha256-hashed) song-group keys of the
split universe (210 groups); every take, mixdown or variant of one song shares
the split. Leakage check: no song_sha256 and no song_group in two splits.

## Caption examples

- `train`: Somali song, led by vocals, the oud (kaban) and hand drums, lively at 163 BPM, pentatonic melody rooted on D, studio recording, clean, performed by Ahmed Ilkacase
- `val`: Somali song, led by vocals, the oud (kaban) and hand drums, moderate at 110 BPM, pentatonic melody rooted on E, studio recording, clean, performed by Ahmed Ilkacase
- `test`: Somali song, led by vocals, the oud (kaban) and hand drums, moderate at 110 BPM, pentatonic melody rooted on E, studio recording, clean, performed by Ahmed Ilkacase

## Notes

- Cut like `build_scale_dataset.py`: 30 s windows, 50 % overlap, peak-normalised to 0.99, clips 20 dB under the file RMS dropped, -14 LUFS; sources under -40 dBFS RMS skipped as silent.
- Resumable: sources whose clips and caption rows exist with the same window and caption version are reused; a song whose split moved has its clips renamed; a `--limit` run keeps the other sources' rows.

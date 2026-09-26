# Set card: ahmed_oud

Built 2026-09-25T20:56:28-05:00 by `scripts/build_sets.py`.

- Rights: `ahmed_ilkacase_consented` — Ahmed Ilkacase's own sessions, consented for training; an adapter may be published, the audio may not.
- Source files this run: 37 of 37 selected (unique songs by sha256: 37, song groups: 26)
- Source audio: 5.01 h (manifest/inventory durations)
- Clips: 1036 × 30 s = 8.63 h (this run: 1036, kept from the previous build: 0)
- Clips per split: {"train": 699, "val": 232, "test": 105}
- Songs per split: {"train": 26, "val": 6, "test": 5}
- Content labels: {"oud": 37}
- Genres (caption): {"qaraami": 36, "heello": 1}
- Skipped at selection: {"collection_as_oud_from_unclassified": 5, "third_party_xml": 11, "third_party_mixed": 20, "content_drums": 69, "content_none": 91, "content_voice": 211, "content_full_mix": 441, "third_party_import": 63, "content_rap": 59, "content_synth": 1, "excluded": 342}
- Skipped at cut (decode errors, silent sources): {}
- Orphan clip files (no caption row): 0 (deleted: 0)
- Caption template version: 1

## Splits

Song-level 80/10/10 by `build_scale_dataset.song_splits` over the sorted (sha256-hashed) song-group keys of the
split universe (210 groups); every take, mixdown or variant of one song shares
the split. Leakage check: no song_sha256 and no song_group in two splits.

## Caption examples

- `train`: qaraami, Somali traditional song, led by the oud (kaban) and hand drums, moderate at 89 BPM, pentatonic melody rooted on A, studio recording, clean, performed by Ahmed Ilkacase
- `val`: qaraami, Somali traditional song, led by the oud (kaban), moderate at 110 BPM, pentatonic melody rooted on C, studio recording, clean, performed by Ahmed Ilkacase
- `test`: qaraami, Somali traditional song, led by the oud (kaban) and hand drums, moderate at 101 BPM, pentatonic melody rooted on G#, studio recording, clean, performed by Ahmed Ilkacase

## Notes

- Cut like `build_scale_dataset.py`: 30 s windows, 50 % overlap, peak-normalised to 0.99, clips 20 dB under the file RMS dropped, -14 LUFS; sources under -40 dBFS RMS skipped as silent.
- Resumable: sources whose clips and caption rows exist with the same window and caption version are reused; a song whose split moved has its clips renamed; a `--limit` run keeps the other sources' rows.

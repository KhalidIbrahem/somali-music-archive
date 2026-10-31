# Model card — `musicgen_small_base` (no adapter)

**Rights class:** `releasable` — Meta's `facebook/musicgen-small` exactly as published, with no adapter and no training on any audio from this project. Its outputs contain no Harvard, oud, `.band` or other project audio and may be published as the baseline side of a listening study. Checked by `apps/web/scripts/check-public-audio-rights.mjs`.

**Artifact:** none of ours; the public checkpoint `facebook/musicgen-small` (weights under Meta's CC-BY-NC 4.0 licence; the site is non-commercial research).

## Use here
The baseline in blind comparisons against the `oud` adapter (`MODEL_CARD_oud.md`): same captions, same seeds, the adapter switched off. Clips in `apps/web/public/study/`, from `data/oud_ab_listening/pair*_base.wav`.

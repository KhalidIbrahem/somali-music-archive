# Model card — `acestep_base` (no adapter)

**Rights class:** `releasable` — ACE-Step 1.5 `xl-sft` exactly as published, with no adapter and no training on any audio from this project. Its outputs contain no Harvard, oud, `.band` or other project audio and may be published as the baseline side of a listening study. Checked by `apps/web/scripts/check-public-audio-rights.mjs`.

**Artifact:** none of ours; the public ACE-Step 1.5 `xl-sft` checkpoint (Apache-2.0).

## Use here
The baseline in blind comparisons against the `ace_clean_oud` and `ace_songs_v4` adapters: same captions (and lyrics), same seeds, the adapter switched off. Clips in `apps/web/public/study/`, from `data/ab_stage3_acelora_vs_acebase/pair*_base.wav` and `data/ab_stageC_v4_vs_acebase/pair*_base.wav`.

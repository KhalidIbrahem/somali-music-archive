#!/bin/bash
# DeepFilterNet3 denoising of every Harvard clip (CPU, ~/ai/df-env), concurrent with the raw run.
REPO=$HOME/Projects/somali-music-archive; TOOLS=$REPO/runs/_tools; DFPY=$HOME/ai/df-env/bin/python
mkdir -p "$REPO/data/clips_denoised"
"$DFPY" -u "$TOOLS/denoise_clips.py" --workers 4 --threads 3 2>&1 | tee -a "$REPO/data/clips_denoised/denoise.log"
echo "DENOISE_EXIT=${PIPESTATUS[0]}" | tee -a "$REPO/data/clips_denoised/denoise.log"

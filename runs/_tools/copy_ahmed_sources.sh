#!/bin/bash
# Copy Ahmed's session audio + the legacy 105 Harvard files from the read-only SSD into the repo data tree.
set -u
REPO=$HOME/Projects/somali-music-archive; SRC="/Volumes/Khalid_Archives/01_Old_Mac_Archive"
LOG=$REPO/data/ahmed_raw/copy.log
mkdir -p "$REPO/data/harvard_raw/legacy" "$REPO/data/ahmed_raw"
echo "$(date '+%F %T') START legacy harvard copy" | tee -a "$LOG"
rsync -a --ignore-existing --include='*/' --include='*.mp3' --exclude='*' "$SRC/01_raw_mp3/" "$REPO/data/harvard_raw/legacy/" 2>&1 | tail -2 | tee -a "$LOG"
rsync -a --ignore-existing --include='*/' --include='*.mp3' --exclude='*' "$SRC/01_raw_mp3 2/" "$REPO/data/harvard_raw/legacy/" 2>&1 | tail -2 | tee -a "$LOG"
echo "$(date '+%F %T') legacy: $(ls $REPO/data/harvard_raw/legacy | wc -l) files" | tee -a "$LOG"
for d in GarageBand Logic; do
  echo "$(date '+%F %T') START $d" | tee -a "$LOG"
  rsync -a --ignore-existing --include='*/' --include='*.aif' --include='*.aiff' --include='*.wav' --include='*.caf' --include='*.mp3' --include='*.m4a' --include='*.flac' --include='*.aac' --include='projectData' --include='*.logic/**' --exclude='*' "$SRC/$d/" "$REPO/data/ahmed_raw/$d/" 2>&1 | tail -2 | tee -a "$LOG"
  echo "$(date '+%F %T') DONE $d: $(find $REPO/data/ahmed_raw/$d -type f | wc -l) files, $(du -sh $REPO/data/ahmed_raw/$d | cut -f1)" | tee -a "$LOG"
done
echo "$(date '+%F %T') COPY_ALL_DONE" | tee -a "$LOG"

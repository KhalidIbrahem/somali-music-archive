# Held page data

`listen-pairs.json` and `generate-grid.json` here are the full versions for the
before/after pairs on `/listen` and the prompt-and-seed picker on `/generate`.
Their 32 clips are not published: Khalid has not listened to and approved them
(2026-11-26). The copies in `lib/` are empty, so both sections stay off the site.

To publish after approval: regenerate with `listen_pairs_build.py` and
`generate_grid_build.py` (apps/ai-service/scripts), which write the clips, the
`lib/` JSON and the rights manifest together. This folder is not read by the app.

# Live demo script — same seed, same audio; new seed, new audio

A four-minute, screen-recordable walk-through of tests 1 and 2 of
`PROOF_OF_GENERATION.md` on the Generate page. Every generation of the large
adapter takes about 41 s for 15 s of audio on this machine, so the recording has
three waits of that length. Nothing here changes the service or the site.

## Before recording

1. The local stack must be up: `bash scripts/dev-up.sh`, then check
   `curl -s 127.0.0.1:8765/health | head -c 200` shows `"ok": true` and
   `http://localhost:3000/generate` loads with the **Model** cards visible
   (the page is in local mode when the cards appear).
2. Open two windows side by side: the browser on `http://localhost:3000/generate`
   and a terminal at the repo root (`cd ~/Projects/somali-music-archive`).
3. In the terminal, paste this once. It hashes the service's most recent
   output files and prints the seed and prompt the service recorded for each:

   ```bash
   last() { for f in $(ls -t services/musicgen-api/outputs/*.wav | head -${1:-2}); do
     printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -c1-16)" \
       "$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('seed=%s  prompt=%s' % (d['seed'], d['prompt'][:40]))" "${f%.wav}.json")"; done; }
   ```

   `services/musicgen-api/outputs/` is where the service writes every clip it
   generates (`MUSICGEN_OUTPUT_DIR`, see `services/musicgen-api/app.py`); the
   browser's player streams those same files.

## On camera

**Say:** "This page calls a MusicGen model running on this Mac. I'll show that
the audio is computed on request: the same seed gives the same waveform
byte-for-byte, and a new seed gives new music."

1. **First generation.** In **Describe the music** paste
   `Somali qaraami led by the oud (kaban), moderate tempo, pentatonic melody, intimate recording`.
   Under **Model** click **large**. Set **Seconds** to `15` and **Seed** to `73`.
   Click **Generate**. While it runs, point at the "Generating…" state and the
   line under it; optionally show the terminal running
   `curl -s 127.0.0.1:8765/health | python3 -c "import json,sys;h=json.load(sys.stdin);print(h['queue'],h['memory'])"`
   so the viewer sees `busy: True` and the MPS memory rise (about 15.8 → 17.0 GB
   allocated during a large generation).
2. **Play it.** When the "Generated piece" card appears, press play for a few
   seconds. Point at **Time to generate** (about 41 s) and the provenance line
   under the player.
3. **Same seed again.** Change nothing. Click **Generate** again and wait.
   Play the new clip: it is the same music.
4. **Prove it in the terminal.** Run `last 2`. The two SHA-256 prefixes are
   identical and both lines say `seed=73`. **Say:** "Two separate requests, two
   separate files written by the service, identical bytes. A playback of a
   stored recording would not depend on a seed at all, and a model that was
   not deterministic could not do this."
5. **New seed.** Change **Seed** to `74`, click **Generate**, wait, play it.
   Different music. Run `last 3`: the newest hash differs from the two seed-73
   hashes.
6. **Optional, new prompt.** Set **Seed** back to `73`, replace the prompt with
   `Somali dhaanto, fast, hand drums`, generate, play, `last 4`. Same seed,
   different prompt, different audio: the seed only fixes the random draw; the
   text drives the model.

**Close:** "The numbers behind this, the file-access trace of the service and
the nearest-neighbour search against the training clips are in
`docs/eval/PROOF_OF_GENERATION.md`."

## If something is off

- No **Model** cards: the site is in demo-examples mode; start the stack with
  `bash scripts/dev-up.sh` and reload.
- `last` prints only one line: the second generation is still running, wait for
  the card.
- A 429 on the page: the service queue (three waiting) is full; wait a minute.

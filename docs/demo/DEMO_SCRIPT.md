# QaraamiGen — 3-minute walkthrough script (screen capture)

**Setup before recording (2 min, off camera)**

1. `launchctl print gui/501/com.qaraamigen.musicgen-api | grep state` → `running`.
   If not: `launchctl bootstrap gui/501 ~/ai/launchd/com.qaraamigen.musicgen-api.plist`.
2. Open `http://127.0.0.1:8765/demo` in a clean browser window on this
   laptop, dark theme, 1280×800 or wider. (Use the Tailscale address
   `http://100.65.5.120:8765/demo` only from another device on your tailnet,
   after `curl http://100.65.5.120:8765/health` works from that device — the
   laptop cannot reliably reach its own Tailscale address; see DEPLOY.md
   "Known issue".) Paste the token from
   `~/ai/musicgen-api/musicgen-api.env` into the API token field once (it
   stays for the tab).
3. Pre-warm: generate once with any adapter so the first on-camera run is not
   the cold one. Set Seconds = 10, CFG = 3, Seed = 42.
4. Have `docs/OUD-LORA-RESULTS.md` and `docs/eval/EVALUATION.md` open in a
   second tab for the one number you will quote.

**Rights line to say on camera, verbatim (once, at the start):**
"Both adapters were fine-tuned on recordings I cannot redistribute: a private
oud collection and the Aryette collection at Harvard's Loeb Music Library.
Nothing you will hear is a source recording. Everything is model output."

---

## 0:00 — Frame it (20 s)

Show the page header. Say: "This is a MusicGen-small model running on my laptop,
with two LoRA adapters trained on Somali qaraami. Same prompt, same random
seed, left is the base model, right is the fine-tuned one, and we score both
with a pentatonic conformity measure I built for the archive."

## 0:20 — Oud, base vs fine-tuned (70 s)

1. Adapter: **oud**. Click **Prompt for adapter** (it fills the oud caption:
   "Somali qaraami led by the oud (kaban), moderate at 100 BPM, pentatonic
   melody rooted on A, intimate home recording").
2. Click **Generate both**. While it runs (~10 s per side): "Batch size one,
   ten seconds of audio takes about four seconds on Apple silicon."
3. Play **base** (5–8 s). Then play **fine-tuned** (5–8 s). Let the difference
   speak; if you narrate, say what you hear, not what the number says.
4. Point at the two PCS tiles and the **voiced fraction** rows. Say: "PCS is
   the share of pitched sound that sits on the detected pentatonic scale.
   Read it with the voiced fraction: on the held-out oud set the adapter
   produces about sixty percent more trackable melody than base — the
   improvement comes from more music, not from silence."
5. One sentence of honesty: "A single click is a demonstration, not a
   measurement. The evaluation is in the repo: held-out token cross-entropy
   on unseen songs, 4.51 to 4.48 on validation, and eight-pair A/B sets."

## 1:30 — Harvard raw, base vs fine-tuned (60 s)

1. Adapter: **harvard_raw**. Click **Prompt for adapter** ("Qaraami,
   traditional Somali music, lively at 129 BPM, pentatonic melody rooted on
   F#, vintage archival recording"). Keep seed 42.
2. **Generate both**. While it runs: "This adapter was trained on 119 tracks
   of mid-century Somali cassette recordings from the Aryette collection.
   The tapes carry hiss and speed drift, and the adapter learns that texture
   too — you will hear it."
3. Play base, then fine-tuned. Point at the tuning-offset row: "The fine-tuned
   output drifts about twenty-plus cents from A440, which is what the real
   cassettes do. The base model sits near zero."
4. Say the headline: "Held-out cross-entropy improved from 4.84 to 4.75 on
   unseen songs, and every checkpoint beat the base model. In July this same
   experiment looked like a failure — until I found that the training
   harness was applying dropout the evaluation path never saw. Fixing that
   one thing turned a negative result into two positive ones."

## 2:30 — Close (30 s)

Switch to the evaluation tab for five seconds; show the results table.
Say: "Everything runs locally, the service is a FastAPI app with a
three-request queue and a pentatonic scorer, and the source audio never
leaves the archive. What comes next is the listening study and the
melody-conditioned model."

Stop recording at ~3:00.

---

**If something goes wrong on camera**

- 429 "queue full": you clicked twice; wait 15 s.
- "Error: 401": token field is empty — paste it again.
- Silence in a clip: regenerate with seed 43; say "sampling" and move on.
- Page unreachable: `curl http://127.0.0.1:8765/health`; if it fails,
  `launchctl kickstart -k gui/501/com.qaraamigen.musicgen-api` and wait 15 s.

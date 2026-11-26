# Recording sheet for a session with a musician

One page to take to a session with a teacher or another player. Khalid's own
three takes are described in `RECORDING_GUIDE.md`; this sheet is the same idea
for someone else's playing.

## Before pressing record

1. The consent form (`CONSENT_FORM.md`) is signed, two copies.
2. Quiet room, soft furniture, fan and fridge off, phones silent.
3. Recorder set to WAV or lossless (iPhone: Settings → Voice Memos → Audio
   Quality → Lossless). Not MP3, not a WhatsApp voice note: both throw away
   sound that cannot be recovered.
4. Microphone or phone on a stand, 30 to 40 cm from the sound hole. **Do not
   move it for the whole session.**
5. Ten-second test, listen back: no crackle on the loudest notes.

## Why the microphone must not move

Measured on two real oud takes and a real voice take from the project's own
corpus (`portfolio_dsp_demo.py`, 40 s mixture, scale-invariant SDR, higher is
better):

| how the oud model was learned | oud | voice |
| --- | --- | --- |
| nothing done (the mixture itself) | 4.4 dB | −4.5 dB |
| from another session (different room and microphone) | 2.9 dB | −5.6 dB |
| from another passage of the same session | 10.8 dB | 5.6 dB |
| Demucs (pretrained neural network, for reference) | 16.9 dB | 12.4 dB |

The separation learns what this oud sounds like in this room. A take from a
different day or microphone position made the result worse than doing nothing.

## The takes

At the start of every take the player says their name, the piece and its scale.

| take | what | length |
| --- | --- | --- |
| 0 | Silence: nobody plays or talks | 10 s |
| 1 | Solo oud, a slow piece, single notes | 2–3 min |
| 2 | Solo oud, a **different** piece (this one teaches the software the instrument) | 2–3 min |
| 3 | Solo oud, a faster piece with ornaments | 1–2 min |
| 4 | Voice alone: the player hears take 1 in headphones and sings over it; only the voice is recorded | same as take 1 |
| 5+ | Anything else the player wants to give: more songs, each as its own file | any |

Takes 0 to 4 are enough for the demos (about ten minutes). Everything after
that builds the long-term collection.

## For each file, write down

| file | player | piece | scale | traditional or composer's name | take |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## Hand-over

- Original files, untouched: no trimming, no noise reduction, no normalising.
- Into `~/Projects/somali-music-archive/data/raw_incoming/<player>_<yyyy-mm>/`
  with this table saved beside them as `PROVENANCE.md`.
- Nothing is published until the form allows it **and** Khalid has listened to
  the exact clip.

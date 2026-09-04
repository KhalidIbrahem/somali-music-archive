# QaraamiGen inference service — deployment (M5 Max, local + Tailscale)

The service (`services/musicgen-api/`) loads `facebook/musicgen-small` once on
MPS with two LoRA adapters (`oud`, `harvard_raw`) and hot-swaps them per
request. Batch size 1 always; one worker; a 3-request queue (4th caller gets
429 + Retry-After). Structured JSON logs with request ids.

## Where it listens

- `http://127.0.0.1:8765` (this machine)
- `http://100.65.5.120:8765` (Tailscale — `khalid-m5-work`; reachable from any
  device on your tailnet, nothing else). It never binds `0.0.0.0`.
- Demo page: `/demo`. Health (no auth): `/health`. Everything else needs
  `Authorization: Bearer <token>`.

The token lives **outside the repo** in `~/ai/musicgen-api/musicgen-api.env`
(mode 600; template at `services/musicgen-api/musicgen-api.env.example`).
Rotate: edit the file, then `launchctl kickstart -k gui/501/com.qaraamigen.musicgen-api`.

## Start / stop / status (launchd user agent)

The plist is `~/ai/launchd/com.qaraamigen.musicgen-api.plist` (KeepAlive:
relaunches on any exit, 10 s throttle; RunAtLoad; logs in `~/ai/musicgen-api/logs/`).

```sh
launchctl bootstrap gui/501 ~/ai/launchd/com.qaraamigen.musicgen-api.plist   # start (and after reboot/login)
launchctl bootout   gui/501/com.qaraamigen.musicgen-api                       # stop
launchctl kickstart -k gui/501/com.qaraamigen.musicgen-api                    # restart
launchctl print    gui/501/com.qaraamigen.musicgen-api | grep -E 'state|pid'  # status
curl -s http://127.0.0.1:8765/health
tail -f ~/ai/musicgen-api/logs/musicgen-api.log
```

**Persistence across login:** launchd only auto-loads plists from
`~/Library/LaunchAgents`. The plist deliberately lives under `~/ai` (the only
location outside the repo this deployment was allowed to write). To make it
start at every login, create the symlink yourself:
`ln -s ~/ai/launchd/com.qaraamigen.musicgen-api.plist ~/Library/LaunchAgents/`.
Until then, run the `bootstrap` line once after each login.

## Known issue: local hairpin to the Tailscale address (2026-09-04)

Verified 25/25 over `http://100.65.5.120:8765` at 11:49. After the 14:07
sleep/wake the laptop came back on a phone-hotspot network (en0 =
192.0.0.2) and requests from this machine *to its own* Tailscale address
started to stall: the server log shows the request arriving and answering in
1 ms, `nc` connects, but the response never returns to the local client.
Restarting the service does not change it (fresh sockets bind fine). Loopback
is unaffected. Tailscale reports no exit node, no shields-up, no health warning.

- **On this laptop, always use `http://127.0.0.1:8765/demo`.**
- **From another tailnet device** use `http://100.65.5.120:8765` or the
  MagicDNS name `http://khalid-m5-work.tail71bdbf.ts.net:8765`. **Verified
  from the peer `khalid-m1-server` on 2026-09-04 14:34:** `/health` 200 in
  0.64 s, `/demo` 200 in 0.49 s. The peer path does not hairpin.
- **A phone must be on the tailnet first.** At the time of writing the
  tailnet has exactly two devices (this Mac and the M1); a phone that is not
  signed into Tailscale gets nothing at that address. Install the Tailscale
  app on the phone, sign in with the same account (ibrahimkhalid032@…),
  confirm it appears in `tailscale status` here, then open the demo URL in
  the phone's browser and paste the token.
- If a peer ever fails: `launchctl kickstart -k gui/501/com.qaraamigen.musicgen-api`,
  then toggle Tailscale off/on in the menu bar, then re-run
  `services/musicgen-api/smoke_test.sh 100.65.5.120` from the peer.

## Endpoints

| route | auth | purpose |
| --- | --- | --- |
| `GET /health` | no | model loaded, adapters, queue depth, MPS memory, uptime |
| `GET /adapters` | yes | adapter metadata: corpus, training config, metrics, provenance text |
| `POST /generate` | yes | `{prompt, duration<=30, cfg 1–10, seed, adapter: base|oud|harvard_raw, score: bool}` → WAV id + provenance (+ PCS when `score`) |
| `GET /audio/{id}` | yes | the generated WAV (32 kHz PCM_16) |
| `GET /generations/{id}` | yes | the JSON metadata written with it |
| `POST /pcs?generation_id=…` or multipart `file` | yes | Pentatonic Conformity Score + voiced fraction, tonic, tuning offset |
| `GET /demo` | no (page); API calls from it need the token | base-vs-adapter side-by-side page |

Every `/generate` response includes a `provenance` string naming the adapter's
training corpus and stating that source audio is not distributed. The service
never serves corpus audio; `outputs/` holds only its own generations (ignored
by git).

## Verify

```sh
services/musicgen-api/smoke_test.sh 127.0.0.1      # 25 checks incl. auth, limits, queue, bind
services/musicgen-api/smoke_test.sh 100.65.5.120   # same over Tailscale
~/ai/musicgen-env/bin/python services/musicgen-api/loadtest.py --n 20   # writes docs/deploy/LOAD_TEST.md
```

## Memory

MusicGen-small + two adapters + torchcrepe ≈ 3.2 GB of MPS driver memory at
rest. The machine is shared with a local-LLM agent system; the service does
not load anything else. Flash-Next is never loaded by anything here.

## Environment

`~/ai/musicgen-env` (Python 3.11, torch 2.14 MPS, transformers 4.57.6, peft
0.20, fastapi, uvicorn). Requirements list: `services/musicgen-api/requirements.txt`.

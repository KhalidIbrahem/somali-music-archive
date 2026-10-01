# Deployment

Two things deploy from this repo: the **public web app** (`apps/web`, Next.js,
on Vercel) and the **inference service** (`services/musicgen-api`, on the M5
Max, local + Tailscale only). The web app never talks to the inference service
in production (`NEXT_PUBLIC_AI_SERVICE_MODE=off`): the Generate, Transcribe
and Listen pages show model output rendered ahead of time and committed under
`apps/web/public/demos/`. No source recording is ever deployed
(`docs/DATA_PROVENANCE.md`; `apps/web/public/audio/` is git-ignored).

## Web app — Vercel (verified locally 2026-09-27, branch `website-v1`)

### 0. Pre-flight on the Mac (all four must pass before a push)

```sh
cd apps/web
npx tsc --noEmit                                   # TypeScript strict, no `any`
npx eslint app components lib                      # 0 errors
rm -rf .next && NEXT_PUBLIC_AI_SERVICE_MODE=off npx next build   # 0 warnings, 23 routes
git ls-files apps/web | grep -iE '\.(wav|mp3|m4a|flac)$'   # only public/sample/*.mp3 and public/demos/generated/*.mp3
```

Mobile check (headless Chrome over the DevTools protocol, no packages), run
against the production build started with `NEXT_PUBLIC_AI_SERVICE_MODE=off npx next start -p 3200`:

```sh
OUT=/tmp/qaraamigen-mobile-check BASE=http://127.0.0.1:3200 node apps/web/scripts/mobile-check.mjs
```

Pass condition: `scrollW` equals the viewport on every public page at 375 px
and 414 px, `btn true` (hamburger visible), `desktopHidden true`, the panel
lists Home, Generate, Transcribe, Listen, Library, Research, and `footer true`.
Screenshots land in `$OUT/shots/`. Passed on 2026-09-27 (`REPORT.md`).

### 1. Vercel project settings (one-time)

The Vercel project is `somali-music-archive` (team *khalid-ibrahims-projects*,
Hobby plan), currently building from pushes to `master` at
`https://somali-music-archive.vercel.app`.

- **Framework preset:** Next.js. **Root directory:** `apps/web`.
- **Build command:** `next build` (default). **Install command:** default
  (`npm install` at the repo root — the monorepo workspaces resolve
  `@sma/types`, `@sma/constants`, `@sma/validators`; `next.config.mjs` has
  `outputFileTracingRoot` pointing at the repo root and `transpilePackages` for
  those three).
- **Node version:** 22.x (Settings → General → Node.js Version). Next 16 needs
  ≥ 20.9.
- **Production branch:** `master`. Merge `website-v1` into `master` to deploy
  it; every other branch gets a preview URL on push.

### 2. Environment variables (Settings → Environment Variables, *Production* and *Preview*)

`NEXT_PUBLIC_*` values are inlined at build time: change one, redeploy.

| variable | value | why |
| --- | --- | --- |
| `NEXT_PUBLIC_AI_SERVICE_MODE` | `off` | public site: no live service; example pages |
| `NEXT_PUBLIC_REQUIRE_AUTH` | `false` | public site without login |
| `NEXT_PUBLIC_ENABLE_DAW` | `false` | studio hidden |
| `NEXT_PUBLIC_ENABLE_LEARN` | `false` | lessons hidden |
| `NEXT_PUBLIC_ENABLE_COURSES` | `false` | courses hidden |
| `NEXT_PUBLIC_GENERATE_SERVED_ONLY` | `true` | (ignored while mode is `off`) |
| `NEXT_PUBLIC_API_URL` | the API project's URL + `/api/v1` | only the invite-only pages use it; harmless when set |
| `NEXT_PUBLIC_AI_URL` | *unset* | must not point at localhost in a production build |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | *unset* | Google button hidden |

Never put a secret in a `NEXT_PUBLIC_` variable. `apps/web/.env.local` is
git-ignored and holds a Vercel CLI token: do not copy it anywhere.

### 3. Deploy

```sh
# from a clean tree, after the pre-flight above
git checkout master && git merge --no-ff website-v1
git push origin master              # Vercel builds and promotes automatically
```

Or, without merging: `git push origin website-v1` gives a preview deployment
of the branch (URL in the Vercel dashboard → Deployments). Push only with
Khalid's go-ahead (`CLAUDE.md`).

Post-deploy checks (curl from any machine):

```sh
D=https://somali-music-archive.vercel.app
for p in / /generate /transcribe /listen /scores/beerdilaacshe; do curl -s -o /dev/null -w "$p %{http_code}\n" $D$p; done
curl -s -o /dev/null -w "%{http_code}\n" $D/demos/generated/showcase_large_004.mp3   # 200: model output
curl -s -o /dev/null -w "%{http_code}\n" $D/audio/qaraami-laxanka.mp3                # 404: source audio never served
```

Then open the site on a phone: hamburger → the five links; play a clip on
Listen; the footer shows the author block and the rights strip.

### 4. Custom domain

1. Buy the domain (any registrar; Hostinger steps are in `docs/GOING-LIVE.md` §3).
2. Vercel dashboard → project `somali-music-archive` → **Settings → Domains →
   Add** `yourdomain.com` and `www.yourdomain.com`. Choose `www` → redirect to
   apex (or the reverse; pick one canonical host).
3. At the registrar's DNS panel create the records Vercel shows:
   - apex `A` → `76.76.21.21`
   - `www` `CNAME` → `cname.vercel-dns.com`
   (or move the nameservers to Vercel's `ns1.vercel-dns.com` / `ns2.vercel-dns.com`
   and let it manage the zone). Propagation: minutes to a few hours; Vercel
   issues the TLS certificate itself once the records verify.
4. After it verifies:
   - API project env `CORS_ORIGINS`: append `,https://yourdomain.com,https://www.yourdomain.com`
     (keep the vercel.app origin), redeploy the API. Only matters if the
     invite-only pages are ever switched on.
   - `apps/web/app/layout.tsx`: set `metadataBase` to the new origin so social
     previews resolve (optional; not set today).
   - Google OAuth origins, if Google sign-in is ever enabled (`docs/GOING-LIVE.md` §2).
5. Re-run the post-deploy curl list against the new domain, including the
   `/audio/...` 404.

### Rollback

Vercel dashboard → Deployments → previous production deployment → **Promote
to Production** (instant, no rebuild).

---

## Inference service — M5 Max, local + Tailscale

The service (`services/musicgen-api/`) loads `facebook/musicgen-small` once on
MPS with two LoRA adapters (`oud`, `harvard_raw`) and hot-swaps them per
request. Batch size 1 always; one worker; a 3-request queue (4th caller gets
429 + Retry-After). Structured JSON logs with request ids.

### Where it listens

- `http://127.0.0.1:8765` (this machine)
- `http://100.65.5.120:8765` (Tailscale — `khalid-m5-work`; reachable from any
  device on your tailnet, nothing else). It never binds `0.0.0.0`.
- Demo page: `/demo`. Health (no auth): `/health`. Everything else needs
  `Authorization: Bearer <token>`.

The token lives **outside the repo** in `~/ai/musicgen-api/musicgen-api.env`
(mode 600; template at `services/musicgen-api/musicgen-api.env.example`).
Rotate: edit the file, then `launchctl kickstart -k gui/501/com.qaraamigen.musicgen-api`.

### Start / stop / status (launchd user agent)

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

**Persistence across login:** the plist lives under `~/ai/launchd/` and is
symlinked into `~/Library/LaunchAgents/` (done 2026-09-04 14:37), so launchd
loads it at every login. If you ever remove the symlink, run the `bootstrap`
line once after each login instead.

### Known issue: this Mac cannot reach its own Tailscale address (2026-09-04)

Confirmed OS-level, not the service: a throwaway `python -m http.server`
bound to 100.65.5.120 is also unreachable from this Mac (connect succeeds,
no response) while the peer `khalid-m1-server` gets 200 from it. Toggling the
Tailscale connection does not change it; there is no exit node, no
`serve`/`funnel` config, no health warning. It appeared after the 14:07
sleep/wake onto a phone-hotspot network (en0 = 192.0.0.2). Loopback is
unaffected.

- **On this laptop use `http://127.0.0.1:8765/demo`.**
- **From any other tailnet device** use `http://100.65.5.120:8765` or
  `http://khalid-m5-work.tail71bdbf.ts.net:8765`. **Verified from the peer
  `khalid-m1-server` on 2026-09-04:** the full smoke test run *from that
  machine* passed 24/24 (auth, limits, all three adapters, PCS by id and by
  upload, queue overflow, demo page; the bind check is local-only), with
  `/health` in 0.64 s and `/demo` in 0.49 s. Run it yourself from a peer:
  `MUSICGEN_API_TOKEN=<token> bash smoke_test.sh 100.65.5.120`
  (or from this Mac: `ssh khalidibrahim@khalid-m1-server "MUSICGEN_API_TOKEN=<token> bash -s 100.65.5.120" < services/musicgen-api/smoke_test.sh`).
- A phone needs the Tailscale app signed into the same account before the
  address exists for it; check it appears in `tailscale status` first.

### Endpoints

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

### Verify

```sh
services/musicgen-api/smoke_test.sh 127.0.0.1      # 25 checks incl. auth, limits, queue, bind
services/musicgen-api/smoke_test.sh 100.65.5.120   # same over Tailscale
~/ai/musicgen-env/bin/python services/musicgen-api/loadtest.py --n 20   # writes docs/deploy/LOAD_TEST.md
```

### Memory

MusicGen-small + two adapters + torchcrepe ≈ 3.2 GB of MPS driver memory at
rest. The machine is shared with a local-LLM agent system; the service does
not load anything else. Flash-Next is never loaded by anything here.

### Environment

`~/ai/musicgen-env` (Python 3.11, torch 2.14 MPS, transformers 4.57.6, peft
0.20, fastapi, uvicorn). Requirements list: `services/musicgen-api/requirements.txt`.

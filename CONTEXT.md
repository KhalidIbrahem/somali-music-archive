# CONTEXT.md — Fable session log

Read this before any task. Update it after every task (§7 of the Block 1 brief).
One entry per task: what changed, what's unblocked, what's still open.

## Current block

**Block 1 — design system extension + screen architecture** (brief dated 2026-08-05).
Direction: professional music software (Dorico/Ableton density). Locked brand tokens
(amber `#C89B5F`, ink-black `#0C0B14`, flag-blue `#4189D4`, Playfair/Nunito) are
untouched; the brief adds a semantic studio token set (chrome/paper/text/confidence),
IBM Plex Mono for numerics, and a dark/light theme system where the score canvas is
always the lightest surface on screen.

## Standing decisions

- **Prior QaraamiGen direction superseded.** The teal `.qg` studio + QaraamiHome
  landing (built earlier on 2026-08-05) are preserved at baseline commit `dff7121`
  and replaced during Block 1. The Block 1 token set is the studio identity.
- **Studio route:** `/studio` is the four-zone Transcription Studio. The archive's
  old `/transcribe` page stays untouched in Block 1.
- **Token single source:** `packages/constants/src/designTokens.ts` holds every
  semantic token value (dark + light). Web consumes a *generated*
  `apps/web/app/tokens.css` (`npm run tokens:gen` at repo root regenerates); mobile
  re-exports from `@sma/constants` via `apps/mobile/theme/studio.ts`. Parity is by
  construction, enforced by a mobile jest test.
- **Sample session data:** promoted from a real notation job
  (`b0c21025…`, vocals): 412 notes / 5:48, tonic A, degrees 2-4-7-9-11,
  +41.6¢ tuning offset, bpm 106, confidence spread 132 low / 115 mid / 165 high.
  Audio for the studio is **synthesized from the note list** (never corpus audio —
  Harvard audio must not deploy; `.gitignore` already blocks
  `apps/web/public/audio/` and `public/demos/audio/`).
- Commit hooks run prettier on staged files automatically.
- No tooling attribution in commit messages (project convention).

## Task log

| Task | Status | Commit | Notes |
|---|---|---|---|
| B1-00 baseline + CONTEXT seed | done | dff7121, c5cf3f6 | prior WIP preserved |
| B1-01 token layer | done | d4a2fe4 | JSON source + tokens.css codegen + mobile re-export; 13-test spec (parity, AA, paper-lightest, 8px grid). **Deviation:** light `--accent-state` corrected `#8A6329`→`#876128` — brief's value measured 4.485:1 on light chrome-1, under the AA floor it exists to clear. Web `numeric` utility + `font-numeric`; Tailwind names: `bg-chrome-1`, `text-hi/mid/low`, `text-accent-state`, `bg-paper`… |
| B1-01b theme switching | done | c1cc748 | Pre-paint bootstrap script in layout body; explicit-choice-only persistence (`sma.theme`); cross-tab sync; ThemeToggle component (mounts in B1-02 top bar); Expo `StudioThemeProvider` + settings-store preference (in-memory like all mobile settings until P2-07). FOUC/timing screenshot check happens with B1-02; AA-in-both-themes already enforced by studio.test.ts. |
| B1-02 chrome shell | done | 0d91dd5 | Four zones live at /studio on layout tokens (`w-(--studio-library-rail)` etc.). qg studio pages deleted (history: dff7121). **Verified headless** (scratchpad cdp.mjs harness — Chrome extension had 2 browsers, user pick timed out): grid holds 1280/1440/1920 no overflow; rails collapse/restore; transport fixed; theme switch 3.6ms; first visit honors system light *without* persisting; explicit choice persists + bootstrap replay honors both values. Real session values in inspector/transport (root A, 2·4·7·9·11, +41.6¢, 106 BPM, 313/412 snapped, conf 165/115/132). |
| B1-03 score canvas + Verovio | done | d94c2c0 | `scripts/build-sample-session.mjs` promotes real notation job → `public/sample/` (score.mei 421 glyphs / session.json 412 logical notes w/ tie groups + per-note conf + MEI ids / audio.mp3 SYNTHESIZED 5.8min). Verovio 6.2 client-side, galley layout, **first engrave 240ms** (<500 target), zoom 50–200% re-engraves at constant 816px paper width. StudioProvider context (session/zoom/selection); inspector + transport now session-driven. Pipeline's red outlier marks flow through — B1-06 must preserve them alongside confidence ink. |
| B1-04 waveform strip | done | 92f5ca9 | Canvas peaks + adaptive mm:ss ruler; wheel time-zoom around pointer, drag pan; DPR + theme-reactive (MutationObserver). **Axis domain = session.meta.durationSec, never mp3 buffer duration** (encoder padding). One linear map (timelineMath) for peaks/ruler/(future) playhead → measured alignment error 0.0000px across zooms (criterion ≤1px). Shared audio.ts caches one AudioContext + decoded buffer for B1-05 playback. |
| B1-05 shared timeline | done | 457d8eb | TimelineEngine: position ≡ AudioContext.currentTime derivation (zero drift by construction); rAF fan-out to imperative subscribers, no per-frame React state. Note click → seek measured **0.000ms** err (limit 20ms) + amber select; ruler-scrub + wave-click seek; blue playing glyph + auto-scroll-into-view; waveform playhead + follow mode; transport play/pause/skips + textContent timecode. 12s empirical sample: Δpos 12.0000s / Δwall 12.002s. Headless harness runs audio via --autoplay-policy flag. |
| B1-06 confidence layer | done | c8e3fb0 | Per-glyph fill-opacity from tier alphas applied imperatively post-engrave (measured 1/0.62/0.34 computed); "Show certainty" chip on canvas → uniform ink in 6.9ms with SVG identity preserved (no re-render, no flicker); state colors exempt via `fill-opacity:1!important`. Hover/focus popover: name + Hz, confidence %, onset–offset, "Play this note" (engine.playSegment stops sample-exact: 14.231≡14.231s). Glyphs are focusable buttons (tabindex/aria-label/focus ring) — keyboard path per §6. Base svg ink = --confidence-ink token. |
| B1-07 landing | done | 8608244 | One claim + REAL engraved hero (build script pre-renders page 1 with confidence ink baked into SVG attrs → `public/sample/hero.svg`, served as priority `<Image unoptimized>` so the doc stays tiny). No stock imagery/grid. **Lighthouse perf 96** (was 88 inline; TBT 0ms, CLS 0), 375px no overflow. QaraamiHome + `.qg` CSS removed (preserved at dff7121). Copy per §5: limits stated plainly, sentence case, zero exclamation marks. |
| B1-08 mobile shell | done | bcd948c | `/reader` score reader: pre-paginated SVGs (5 pages, confidence baked, note page+y extracted from Verovio transforms) in a windowed FlatList; pinch 1–2.5×; playback via expo-audio with follow-the-note auto-scroll (audio clock = truth; math unit-tested incl. the zoom·fit scaling); manual scroll pauses follow, chip resumes. Welcome CTA links to it pre-auth. Existing welcome/auth/library screens already sit on the shared brand values; token parity is by construction (one JSON source). **Verified: tsc strict, 139/139 jest, expo export bundles (mp3 asset included). NOT yet run on a device/simulator — pinch + follow need a hands-on smoke test next session.** |

## Block 1 status: COMPLETE (all 8 tasks + baseline, 11 commits dff7121…bcd948c)

## Aug 5 PM — deploy + registration session

Web (Block 1) and API are both LIVE and verified in production. Registration
works end to end (API 201 + browser flow on /register). Fixed along the way:
observable serverless boot (503 BOOT_FAILED + step instead of platform 500),
6s Mongo server-selection cap, per-field VALIDATION_ERROR surfacing on the web
register form (+ client-side letter+digit mirror). Root causes were: Atlas IP
allowlist (user fixed), then password-composition failures hidden behind the
generic banner. Auth rate limiting is per-IP and correct — dev machine +
browser share one egress IP, so test bursts throttle themselves (5/15min).
Smoke accounts created: b1-smoke-api@example.com, b1-smoke-web@example.com
(listener role — delete or keep as test fixtures; rotation task still open).

## Aug 6 — library upload fix

Root cause of "Could not reach the server" on library PDF upload: the R2
bucket had NO CORS configuration → browser preflight on the presigned PUT got
403 → fetch rejected client-side (never reached a Vercel function, hence
empty function logs). Fixed via `scripts/r2-cors.mjs` (infra-as-code; prod +
localhost origins, PUT/GET/HEAD). Verified E2E in production: presign 201 →
R2 preflight 204 + PUT 200 → register 201 → shelf renders; object confirmed
in R2 (439B application/pdf), metadata served by GET /library/books.
**Two open flags:** (1) web redeploy with the improved storage-error copy is
pending — Vercel CLI session expired again; needs the durable `.vercel-token`
(never created; yesterday was a re-login). (2) library.repository is
in-memory by design ("until a Prisma/Mongo model") — on serverless, shelf
metadata is lost on cold start while files persist in R2; needs a real model
before the library is production-durable.

## Addendum task log (Aug 6)

| Task | Status | Notes |
|---|---|---|
| B1-09 diagnosis + banner | done | Emulated mobile clean (engrave 241ms @390px, zero console/hydration errors); Verovio wasm INLINED in JS (no .wasm request → header question N/A); IG/FB/Line/TikTok banner verified show/dismiss/absent-in-Safari; favicon added. Real-device pass still needed. Gotcha: orphaned next-server on :3000 serves stale builds — kill by port. |
| B1-12 landing copy | done | Qaraami-led headline; "AI-powered" removed from hero+title; CTAs content-width; secondary border → mid (≥3:1 both themes). |
| B1-10 hero replacement | done | fixtures/hero-excerpt.mei hand-curated (12 bars 6/8, A pentatonic naturals-only, treble-8vb, beat beams, phrase-aligned 2 systems via <sb/>+breaks:line — verovio quirks: leading XML comment breaks format sniffing; 'encoded' breaks unreliable, 'line' honors sb). build-hero.mjs asserts mobile ≤2 systems + staff gap ≥6px (10.8px). PLACEHOLDER STATUS: synthesized audio, swap path in fixture header for Khalid's own recording. Old pipeline hero retired. |
| B1-11 hero playback | done | Inline SVG variants + lazy HTMLAudio (329KB pre-interaction, budget 500; audio only on press). Media clock drives amber reached-ink + blue playhead (26 notes @6s = exact eighth math); reduced-motion steps note-to-note; end resets. Real mobile Safari untested from this machine. |
| B1-14 audio inventory | done | docs/audio-inventory.md — 21 individual assets + 3 aggregate pipeline rows; only synthesized fixtures owned outright; 5 DANGLING Mongo seed refs (R2 objects never uploaded); demo stems publicly served at /demos; R2 holds 1 AI-generated clip + 3 real library PDFs (user uploading!). Selection stays with Khalid. |
| B1-15 listening room | done | PlayerProvider in root layout (audio survives routes — verified counter advancing across navigation); PlayerBar: peaks scrubber (8kHz decode, designed flat-bed fallback), mono elapsed/-remaining, prev/next, volume, buffering/error/end states; keyboard space/±5s/volume verified with input+button guards; 9 records ALL with rights lines; 8 honest "No score yet"; sample session = the transcribed track with detected root/tempo chips + ListenScore panel following the player clock (blue cursor + auto-scroll, confidence ink baked). Old ListeningRoom superseded (git history). |
| B1-13 history scrub | done | Mirror backup at `../somali-music-archive-backup.git` (pre-rewrite). git-filter-repo removed CLAUDE.md/.mcp.json/.claude from all 91 commits + stripped attribution trailers (incl. the "Claude Fable 5" form the provided regex missed). Working-tree citations retarget to root CONVENTIONS.md (rules preserved verbatim). Audits: 0 log matches; tree grep matches only .gitignore's own ignore entries (structural — the spec's gitignore step guarantees it). Fresh clone installs + builds ✓. Force-pushed to github.com/KhalidIbrahem/somali-music-archive (42d3d83→64b876a). **Every pre-Aug-6 hash in this file is now historical.** GitHub-side PR/issue text (if any) needs manual UI review per the spec's own warning. |

## Aug 6 PM — QaraamiGenAI identity import

Logo concepts imported from the claude.ai design project (via the user's
browser; the design-MCP is now wired in .mcp.json — needs session reconnect +
/design-login for native access next time). Source of record committed at
`fixtures/qaraamigen-logo.dc.html` (viewer-runtime scripts stripped;
`support.js` in the project is the generated dc-runtime harness — nothing to
implement from it). Four concepts reviewed (1A Seal / 1B Q-String / 1C
Staff-Horizon / 1D Aperture); **1A implemented** as
`components/brand/QaraamiGenLogo.tsx` (size-specific redraws per the study;
waveform on accent-state so light theme stays AA — deliberate deviation from
the study's single-ink cream sheet), favicon replaced (seal on ink tile),
landing header/footer carry the lockup. Studio surfaces intentionally
untouched pending the cinematic landing build, which is STILL BLOCKED on
`QaraamiGen-landing-copy.md` (not on this machine; user to supply).

## Aug 6 late — cinematic QaraamiGenAI landing

Full documentary-register rebuild of `/` per the QaraamiGen build brief: hero
(silence→"Until now." beat, CSS-only entry so LCP never waits for hydration),
proof section (the playable engraving), four story sections incl. a real
waveform→notation scroll morph (peaks decode gated by IntersectionObserver),
museum-label stat callouts (real numbers only), closing held-note (in-browser
KS synth of A2, fades to silence, never autoplays), static film-grain veil.
**Copy provenance:** `QaraamiGen-landing-copy.md` still does not exist
anywhere reachable (disk/Canva/design project re-checked); per the brief's
no-invented-copy rule, every string lives in `lib/landingCopy.ts` and traces
to the author's own brief text, shipped B1-12 lines, or verifiable project
numbers — the copy bank drops into that one file when it lands. Perf: 62→94
Lighthouse (hero was Reveal-gated = 4.2s LCP; WaveToScore eagerly decoded
audio). 341KB pre-interaction, TBT 30ms, CLS 0.

## Aug 6 night — QaraamiGenAI rebrand sweep

Every user-facing "Somali Music Archive" replaced with the QaraamiGenAI brand:
web metadata titles (root/studio/listen/library/generate/transcribe), root
description (drops "AI-powered" phrasing), SiteHeader + studio top bar now
carry the seal mini-lockup (old LogoMark removed), login/register kickers,
paper header on the score canvas, hero attribution line; API email subjects +
notification title; mobile unlock prompt, app display name, and mic
permission copy (app.json slug untouched). Deliberately KEPT: the lockup's
designed strapline "Somali music archive" (institution descriptor under the
brand, per the identity study) and factual rights lines ("Harvard Loeb…").
Note: `QaraamiGenlandingpageprompt.md` in Downloads is the build brief itself
— the copy bank `QaraamiGen-landing-copy.md` still does not exist.

## Aug 7 — copy bank curated + Beerdilaacshe score page

**Copy bank (1b2005a):** `QaraamiGen-landing-copy.md` landed at repo root and is
curated into `lib/landingCopy.ts` under the provenance rule. The user maintains
their own shortlist in that file as `// alt:` comments — choose within it, never
overwrite it wholesale (a Write conflict on Aug 6 revealed their curation; my
independent draft was discarded). Active picks: headline "A nation's memory,
held together by cassette tape." / closing body "Nothing here will ever be lost
again." Still open user-side: oud recording → `fixtures/hero-audio-source.wav`;
their iPhone Safari + IG banner pass.

**Beerdilaacshe (/scores/beerdilaacshe):** first entry in the qaraami songbook —
engraved sheet music with an in-browser performance. Melody by Abdillahi Qarshe
(1950s), sheet music by Khalid Ibrahim (credits verbatim from his .ly header,
also in page metadata authors/other). Assets in `public/scores/beerdilaacshe/`
(PDF + MIDI + LilyPond source, all downloadable); `scripts/build-score.mjs` is a
generic SMF parser (VLQ, running status, tempo map) → `notes.json` (126 notes,
96bpm, 4/4, 87.5s). `components/scores/ScorePlayer.tsx`: NO GM piano — melody is
Karplus-Strong plucked synthesis voiced after the oud (doubled course ±5¢ +
0.006s offset, faint f/2 resonance) over a durbaan groove (swept-sine dum,
highpass-noise tak; dum·tak·ghost·dum·tak per 4/4 bar), whole mix pre-rendered
to one AudioBuffer inside the tap gesture (264ms), peak-normalized 0.86;
pause=ctx.suspend/resume=ctx.resume. "Scores" added to SiteHeader NAV. Verified
headless: play→bar 4.6%→8.6%, pause freezes clock, stop resets; captured buffer
peak 0.860/RMS 0.054 with signal at t=0 through the final decay; PDF `<object>`
renders inline (Chrome viewer) with download fallback; 390px no overflow.
CDP-harness gotcha: promise-returning evals need top-level `await` in the
expression — bare promises serialize as `{}` despite awaitPromise:true.

## Aug 7 PM — accounts + teaching release (pre-domain)

Built for the Hostinger-domain launch and Prof. Rehanna Kashogi (ethnomusicology)
uploading course material. All layers tested; api 309/310 (the 1 failure is the
pre-existing lyria one), web builds 18 routes, mongo repos proven against a real
mongod (mongodb-memory-server).

- **Auth**: login accepts email OR E.164 phone in one identifier field (legacy
  `{email}` shape still valid — mobile/admin untouched); register takes optional
  phone (unique, normalised, `AUTH_PHONE_TAKEN`); `POST /auth/google` verifies a
  GIS credential (google-auth-library), links by email, creates verified
  accounts with unguessable password hashes — env-gated by `GOOGLE_CLIENT_ID` /
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (unset → button hidden, endpoint 503s
  `AUTH_PROVIDER_UNAVAILABLE`). Web now stores the REFRESH token too;
  lib/api single-flight-refreshes on `AUTH_TOKEN_EXPIRED` and replays once —
  sessions no longer die at 15 min.
- **Educator role** (`USER_ROLES` in @sma/types is now the canonical list):
  requireEducator = educator|admin; requireContributor now admits educators.
  Prisma migration `20260807000000_educator_role_phone` (enum value + nullable
  unique `users.phone`) APPLIED TO PROD Supabase. Admin endpoints
  `GET /users?q=` + `PATCH /users/:id/role` (cannot change own role);
  `npm run promote -- <email> <role>` now updates Postgres when
  PERSISTENCE=database (dev-store otherwise).
- **Education module** (`/api/v1/education`): TeachingLesson (title, summary,
  body, track, ≤10 attachments, draft/published, soft delete) in Mongo
  (`teaching_lessons`), in-memory driver for tests. Public reads (list shows
  published only; drafts 404 for non-authors — maybeAuthenticate middleware),
  educator-gated authoring, presigned R2 uploads under new `lessons/` prefix
  (+ `audio/mp4` extension mapping), per-lesson signed attachment reads (key
  must belong to the lesson). Attachment keys are verified to exist in R2
  before a lesson accepts them.
- **Library durability FIXED**: `library_books` Mongo model + repository binds
  when PERSISTENCE=database — the Aug 6 "shelf empties on cold start" flag is
  closed.
- **Web**: AuthMenu chip (site + landing variants) in SiteHeader and the
  landing header — name, role badge, My account / Teaching studio / Admin /
  Sign out (SIGN OUT NOW EXISTS; calls POST /auth/logout then clears both
  tokens). `/account` dashboard (profile, phone, editable display name, role
  sections, sign out). `/learn` + `/learn/[id]` public lesson pages (track
  filter, paragraph rendering, signed attachment opens, inline audio).
  `/teach` educator studio (composer with multi-file presigned upload,
  draft/publish, list with publish-toggle + confirm-delete). Login page:
  single "Email or phone" field + optional Google button + safe `?next=`
  redirect. Register: optional phone field + Google. "Learn" added to nav.
- **Local E2E smoke passed** (memory mode, real HTTP): register w/ phone →
  login by phone → public lesson reads → 403 for listener authoring → admin
  role grant → educator draft/publish/delete → R2 presign shape → logout
  revocation → google 503 when unconfigured.
- **Docs**: `docs/GOING-LIVE.md` — Rehanna onboarding (register → promote),
  Google OAuth setup, Hostinger DNS → Vercel, CORS/R2/OAuth origin updates for
  the new domain. `.env.example`s document the two Google vars.
- **Gotcha for smoke tests**: authLimiter 5/15min/IP counts register+login+
  google together — local bursts must restart the API (memory mode) or wait.
- **DEPLOYED + VERIFIED IN PROD** (somali-music-archive-api / somali-music-archive
  on Vercel, via scripts/vercel-deploy.mjs — the durable `.vercel-token` file now
  exists, so the CLI-session expiry problem is gone). Prod smoke: register w/
  phone → phone-identifier login → educator promote (script, live Postgres) →
  refresh picks up role → draft in prod Mongo (privacy held) → R2 presign →
  soft delete → demoted back. Headless-Chrome CDP pass on the live site:
  login → header chip → /account (email/phone/educator card) → /teach unlocked
  → menu sign-out cleared both tokens. Fixture account
  teaching-smoke-1786151232@example.com (listener) joins the b1-smoke pair.
  Login-page fix along the way: ?next read at submit time, not useSearchParams,
  so the form stays in the static HTML (764dbaa).

## Open items for the next session

- **Pre-existing api test failure (not Block 1):** `apps/api` lyria.test.ts expects
  `lyria-3-clip-preview` but resolves provider `local` — arrived with the prior
  session's WIP at dff7121; `git diff dff7121..HEAD -- apps/api` is empty. Belongs
  to the generation layer (Block 4 scope). 281/282 api tests pass.
- **Mobile device smoke test:** reader pinch + follow-scroll are unit-tested and
  bundle cleanly (expo export) but have not run on hardware. `npx expo run:ios
  --device` (remember: strip aps-environment after prebuild; see memory).
- Screen 4 (upload → instrument select), 6 (score view/export), 7 (generation
  studio restyle), 8 (account) from §4 are NOT in Block 1's task list — they open
  Block 2+.
- Export with confidence summary (§3) lands with screen 6.
- Block 2 moves theme persistence from localStorage/settings-store to the user record.
- Verification harness: headless-CDP script (screenshots, evals, prefers-color-scheme
  emulation, autoplay) lives in the session scratchpad as `cdp.mjs` — recreate from
  the B1-02 CONTEXT notes if needed; consider promoting a copy into `scripts/` if it
  keeps earning its place.

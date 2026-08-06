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
- No Claude attribution in commits (project CLAUDE.md).

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

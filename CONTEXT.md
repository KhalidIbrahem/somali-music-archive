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
| B1-01 token layer | done | (next) | JSON source + tokens.css codegen + mobile re-export; 13-test spec (parity, AA, paper-lightest, 8px grid). **Deviation:** light `--accent-state` corrected `#8A6329`→`#876128` — brief's value measured 4.485:1 on light chrome-1, under the AA floor it exists to clear. Web `numeric` utility + `font-numeric`; Tailwind names: `bg-chrome-1`, `text-hi/mid/low`, `text-accent-state`, `bg-paper`… |
| B1-01b theme switching | open | | |
| B1-02 chrome shell | open | | |
| B1-03 score canvas + Verovio | open | | |
| B1-04 waveform strip | open | | |
| B1-05 shared timeline | open | | |
| B1-06 confidence layer | open | | |
| B1-07 landing | open | | |
| B1-08 mobile shell | open | | |

## Open questions / risks

- Verovio npm package must install on this network (npm worked in July sessions).
- Mobile score reader (B1-08) renders Verovio inside a WebView — read-only.
- Block 2 will move theme persistence from localStorage to the user record.

# Upstream contributions: status

Checked 2026-11-21 against the GitHub API and `huggingface/transformers` main `2f1bc5e`.

## What was reported

| issue | defect | state |
| --- | --- | --- |
| [#49094](https://github.com/huggingface/transformers/issues/49094) | MusicGen hub configs carry `dropout=0.1`; the checkpoints were trained with 0. `train()` doubles the loss, so a fine-tune optimises a path `generate()` never uses. | Closed by the stale bot 2026-11-03. Not fixed. No open PR (#49104 and #49219 were closed unmerged). Never labelled `triaged`. |
| [#49095](https://github.com/huggingface/transformers/issues/49095) | `forward(labels=...)` raises "set the decoder_start_token_id" on every released MusicGen checkpoint. | Closed by the stale bot 2026-11-03. Not fixed. PR [#49118](https://github.com/huggingface/transformers/pull/49118) (another contributor) is open and is the one the maintainers kept; it waits on review. |

Both still reproduce on main (`docs/oss/musicgen_main_check.py`, run 2026-11-21, 5.24.0.dev0):
`ValueError` for #49095; eval loss 4.4363 against train loss 10.2944 for #49094.

## What the project's rules allow

From `.ai/AGENTS.md` and `CONTRIBUTING.md` on main:

- A PR that fixes an issue may only come from the issue's author **after a maintainer labels it `triaged`**
  (or it is labelled `contributions-welcome`). #49094 has neither, so a PR now would be closed.
- When a PR for an issue already exists, no second PR, and no "verified, works" comments on it. That
  rules out a PR or a test report for #49095 while #49118 is open.
- A bug report needs a reproducer run on the latest release or main. We have one.
- A maintainer warned two contributors on these same threads against PRs produced by code agents.
  Any PR here has to be one Khalid has read, run and can explain line by line.

## Steps, in order

1. **Khalid, now:** one short comment on #49094, in his own words, saying it still reproduces on main
   and asking for it to be reopened. Facts to include: main `2f1bc5e`, `facebook/musicgen-small`, eval loss
   4.4363, train loss 10.2944, and that the script in the issue body runs in about a minute on CPU.
   Nothing more. No request to be assigned.
2. **If a maintainer reopens and labels it `triaged`:** open the PR from
   `transformers_musicgen_dropout_fix.diff`. Before that it must be re-anchored on main, reduced to one
   regression test, and its `# Copied from` line replaced (main no longer accepts new ones).
3. **#49095:** wait for #49118. If it merges, the portfolio says "reported by me, fixed in #49118".
4. **Unsubmitted:** `transformers_musicgen_melody_prefix_issue.md` (third defect). Reproduce on main before filing.

## How the portfolio words it

"Reported two defects in `huggingface/transformers` MusicGen that silently break fine-tuning, each with
a one-minute reproducer; both still reproduce on main as of 2026-11-21; a fix for one is in review
upstream (#49118)." No claim of a merged PR unless one merges.

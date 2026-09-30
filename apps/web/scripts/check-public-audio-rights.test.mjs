import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardRights, check } from './check-public-audio-rights.mjs';

const OK_CARD = '# card\n\n**Rights class:** `releasable` — own recordings.\n';
const RESEARCH_CARD = '# card\n\n**Rights class:** `research_only` — Harvard.\n';
const OUD = 'apps/web/public/demos/generated/oud_000_adapter.mp3';
const LARGE = 'apps/web/public/demos/generated/large_000_adapter.mp3';

function base(overrides = {}) {
  return {
    audioFiles: [OUD],
    manifest: { files: { [OUD]: { kind: 'model_output', adapter: 'oud', rights: 'releasable' } } },
    cards: { oud: OK_CARD },
    cardsAvailable: true,
    references: [
      { source: 'apps/web/lib/demoExamples.ts', ref: '/demos/generated/oud_000_adapter.mp3' },
    ],
    ...overrides,
  };
}

test('a releasable clip with a matching card passes', () => {
  assert.deepEqual(check(base()), []);
});

test('reads the rights class from a model card', () => {
  assert.equal(cardRights(OK_CARD), 'releasable');
  assert.equal(cardRights(RESEARCH_CARD), 'research_only');
  assert.equal(cardRights('# no rights line'), null);
});

test('an unlisted shipped audio file fails', () => {
  const errors = check(base({ audioFiles: [OUD, LARGE] }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /large_000_adapter\.mp3: shipped audio not listed/);
});

test('audio outside the shipped roots is ignored', () => {
  assert.deepEqual(check(base({ audioFiles: [OUD, 'data/ab_medium/pair000_base.wav'] })), []);
});

test('a research-only adapter fails even if the manifest calls it releasable', () => {
  const manifest = {
    files: { [LARGE]: { kind: 'model_output', adapter: 'large', rights: 'releasable' } },
  };
  const errors = check(
    base({ audioFiles: [LARGE], manifest, cards: { large: RESEARCH_CARD }, references: [] }),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /MODEL_CARD_large\.md says research_only/);
});

test('a research_only manifest entry fails without the cards too', () => {
  const manifest = {
    files: { [LARGE]: { kind: 'model_output', adapter: 'large', rights: 'research_only' } },
  };
  const errors = check(
    base({ audioFiles: [LARGE], manifest, cards: {}, cardsAvailable: false, references: [] }),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /research_only, not releasable/);
});

test('a missing card or a card without a rights line counts as research-only', () => {
  assert.match(check(base({ cards: {} }))[0], /no model card/);
  assert.match(check(base({ cards: { oud: '# card' } }))[0], /no "\*\*Rights class:\*\*" line/);
});

test('a reference to an unlisted generated file fails', () => {
  const errors = check(
    base({
      references: [
        { source: 'apps/web/lib/demoExamples.ts', ref: '/demos/generated/large_000_adapter.mp3' },
      ],
    }),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /references \/demos\/generated\/large_000_adapter\.mp3/);
});

test('a listed file missing from the checkout fails', () => {
  assert.match(check(base({ audioFiles: [] }))[0], /not in the checkout/);
});

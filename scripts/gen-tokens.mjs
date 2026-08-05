#!/usr/bin/env node
/**
 * gen-tokens.mjs — generate apps/web/app/tokens.css from the token source
 * (packages/constants/src/designTokens.json). Run via `npm run tokens:gen`
 * whenever the JSON changes; the output file is committed.
 *
 * Emits, in order:
 *   :root                      dark values (the default theme)
 *   :root[data-theme='light']  light overrides
 *   @media print               light values forced regardless of active theme
 *                              (the score must always print on a light page)
 * plus theme-independent confidence ink and 8px-grid layout vars on :root.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'packages/constants/src/designTokens.json');
const target = join(root, 'apps/web/app/tokens.css');

const tokens = JSON.parse(readFileSync(source, 'utf8'));

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function themeDecls(theme) {
  return Object.entries(theme)
    .filter(([key]) => key !== '$comment')
    .map(([key, value]) => `  --${key}: ${value};`)
    .join('\n');
}

function confidenceDecls() {
  const { ink, tiers } = tokens.confidence;
  const [r, g, b] = hexToRgb(ink);
  const rgba = (alpha) => (alpha >= 1 ? ink : `rgba(${r}, ${g}, ${b}, ${alpha})`);
  return [
    `  --confidence-ink: ${ink};`,
    `  --confidence-high: ${rgba(tiers.high.alpha)};`,
    `  --confidence-mid: ${rgba(tiers.mid.alpha)};`,
    `  --confidence-low: ${rgba(tiers.low.alpha)};`,
  ].join('\n');
}

function layoutDecls() {
  const px = (n) => `${n}px`;
  const l = tokens.layout;
  return [
    `  --studio-grid: ${px(l.grid)};`,
    `  --studio-control: ${px(l.controlHeight)};`,
    `  --studio-control-compact: ${px(l.controlHeightCompact)};`,
    `  --studio-radius-control: ${px(l.radiusControl)};`,
    `  --studio-radius-panel: ${px(l.radiusPanel)};`,
    `  --studio-radius-canvas: ${px(l.radiusCanvas)};`,
    `  --studio-top-bar: ${px(l.topBarHeight)};`,
    `  --studio-library-rail: ${px(l.libraryRailWidth)};`,
    `  --studio-inspector-rail: ${px(l.inspectorRailWidth)};`,
    `  --studio-waveform: ${px(l.waveformHeight)};`,
    `  --studio-transport: ${px(l.transportHeight)};`,
  ].join('\n');
}

const css = `/* GENERATED FILE — do not edit by hand.
 * Source: packages/constants/src/designTokens.json
 * Regenerate: npm run tokens:gen (root)
 *
 * Semantic studio tokens (Block 1 brief §1). Dark is the default; light is
 * activated by data-theme='light' on <html>. Confidence ink and the 8px-grid
 * layout vars are theme-independent. Printing always uses the light values —
 * an engraved score must come out dark ink on a light page.
 */

:root {
${themeDecls(tokens.themes.dark)}
${confidenceDecls()}
${layoutDecls()}
  color-scheme: dark;
}

:root[data-theme='light'] {
${themeDecls(tokens.themes.light)}
  color-scheme: light;
}

@media print {
  :root,
  :root[data-theme] {
${themeDecls(tokens.themes.light)}
    color-scheme: light;
  }
}
`;

const config = (await prettier.resolveConfig(target)) ?? {};
const formatted = await prettier.format(css, { ...config, parser: 'css' });
writeFileSync(target, formatted);
console.log(`wrote ${target}`);

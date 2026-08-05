/**
 * Block 1 token-layer spec (design brief §1) as executable assertions.
 *
 * Web and mobile both read packages/constants/src/designTokens.json (web via
 * the generated tokens.css, mobile via @sma/constants), so asserting the values
 * here guards BOTH platforms against drift. The invariants below are the
 * brief's own rules — if a token edit breaks one, the edit is wrong.
 */

import {
  CONFIDENCE_INK,
  CONFIDENCE_TIERS,
  confidenceAlpha,
  confidenceTier,
  studioLayout,
  studioThemes,
  type StudioTheme,
} from './studio';

// ── WCAG 2.x relative luminance + contrast ───────────────────────────────────

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
}

function linearize(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => linearize(channel(hex, i)));
  if (r === undefined || g === undefined || b === undefined) throw new Error(`bad hex ${hex}`);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-composite `fg` over `bg` (both hex) and return the resulting hex. */
function composite(fg: string, bg: string, alpha: number): string {
  const mix = [0, 1, 2]
    .map((i) => Math.round(255 * (channel(fg, i) * alpha + channel(bg, i) * (1 - alpha))))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  return `#${mix}`;
}

// ── Exact values from the brief (§1) — guards the JSON source ────────────────

describe('studio tokens match the Block 1 brief', () => {
  test('dark theme values', () => {
    expect(studioThemes.dark).toEqual<StudioTheme>({
      page: '#0C0B14',
      chrome1: '#14131D',
      chrome2: '#1E1C29',
      hairline: '#2A2836',
      textHi: '#EDEAF2',
      textMid: '#9A96A8',
      textLow: '#5F5B70',
      paper: '#F5F1E8',
      paperEdge: '#E8E2D4',
      accentState: '#C89B5F',
      accentLive: '#4189D4',
      danger: '#C4574F',
    });
  });

  test('light theme values', () => {
    expect(studioThemes.light).toEqual<StudioTheme>({
      page: '#E4E1DA',
      chrome1: '#EDEAE3',
      chrome2: '#F7F5F0',
      hairline: '#CFCBC2',
      textHi: '#1A1822',
      textMid: '#5A5666',
      textLow: '#8E8A99',
      paper: '#FFFFFF',
      paperEdge: '#D8D4CA',
      // Brief said #8A6329, but that measures 4.485:1 on light chrome-1 —
      // under the AA floor it exists to clear. #876128 is the same ramp at 4.6:1.
      accentState: '#876128',
      accentLive: '#2C6BB0',
      danger: '#A83F38',
    });
  });

  test('locked brand values are unchanged (CLAUDE.md)', () => {
    expect(studioThemes.dark.page).toBe('#0C0B14'); // ink-black
    expect(studioThemes.dark.accentState).toBe('#C89B5F'); // oud amber
    expect(studioThemes.dark.accentLive).toBe('#4189D4'); // flag blue
  });
});

// ── Governing rule: the score canvas is the lightest surface on screen ───────

describe('paper is the lightest surface in both themes', () => {
  test.each(['dark', 'light'] as const)('%s theme', (name) => {
    const t = studioThemes[name];
    for (const surface of [t.page, t.chrome1, t.chrome2]) {
      expect(luminance(t.paper)).toBeGreaterThan(luminance(surface));
    }
  });
});

// ── WCAG AA (quality floor §6): text and accents on chrome surfaces ──────────

describe('contrast on chrome surfaces', () => {
  test.each(['dark', 'light'] as const)('%s theme meets AA', (name) => {
    const t = studioThemes[name];
    for (const surface of [t.chrome1, t.chrome2]) {
      // 4.5:1 — normal-size text and icon-with-text pairs.
      expect(contrast(t.textHi, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.textMid, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accentState, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accentLive, surface)).toBeGreaterThanOrEqual(4.5);
      // 3:1 — danger is reserved for large/bold destructive controls and icons.
      expect(contrast(t.danger, surface)).toBeGreaterThanOrEqual(3.0);
    }
    // text-low is disabled/placeholder only — exempt from AA by definition.
  });
});

// ── Confidence ink (§3): theme-independent, readable on paper ────────────────

describe('confidence ink', () => {
  test('is ink-black at the three brief opacities', () => {
    expect(CONFIDENCE_INK).toBe('#0C0B14');
    expect(CONFIDENCE_TIERS.high).toEqual({ min: 0.9, alpha: 1 });
    expect(CONFIDENCE_TIERS.mid).toEqual({ min: 0.7, alpha: 0.62 });
    expect(CONFIDENCE_TIERS.low).toEqual({ min: 0, alpha: 0.34 });
  });

  test('tier boundaries are exact', () => {
    expect(confidenceTier(0.9)).toBe('high');
    expect(confidenceTier(0.8999)).toBe('mid');
    expect(confidenceTier(0.7)).toBe('mid');
    expect(confidenceTier(0.6999)).toBe('low');
    expect(confidenceTier(0)).toBe('low');
    expect(confidenceAlpha(0.95)).toBe(1);
    expect(confidenceAlpha(0.75)).toBe(0.62);
    expect(confidenceAlpha(0.1)).toBe(0.34);
  });

  test.each(['dark', 'light'] as const)(
    'full and mid ink pass AA against %s-theme paper (§6 quality floor)',
    (name) => {
      const paper = studioThemes[name].paper;
      expect(contrast(CONFIDENCE_INK, paper)).toBeGreaterThanOrEqual(4.5);
      const midInk = composite(CONFIDENCE_INK, paper, CONFIDENCE_TIERS.mid.alpha);
      expect(contrast(midInk, paper)).toBeGreaterThanOrEqual(4.5);
      // low tier is deliberately faint — it is the uncertainty signal itself.
    },
  );
});

// ── Layout (§2): strict 8px baseline grid ────────────────────────────────────

describe('studio layout grid', () => {
  test('every zone and control size is a multiple of 8', () => {
    const {
      controlHeight,
      controlHeightCompact,
      topBarHeight,
      libraryRailWidth,
      inspectorRailWidth,
      waveformHeight,
      transportHeight,
    } = studioLayout;
    for (const v of [
      controlHeight,
      controlHeightCompact,
      topBarHeight,
      libraryRailWidth,
      inspectorRailWidth,
      waveformHeight,
      transportHeight,
    ]) {
      expect(v % 8).toBe(0);
    }
  });

  test('brief dimensions', () => {
    expect(studioLayout.topBarHeight).toBe(56);
    expect(studioLayout.libraryRailWidth).toBe(280);
    expect(studioLayout.inspectorRailWidth).toBe(320);
    expect(studioLayout.waveformHeight).toBe(96);
    expect(studioLayout.transportHeight).toBe(64);
    expect(studioLayout.radiusControl).toBe(4);
    expect(studioLayout.radiusPanel).toBe(0);
    expect(studioLayout.radiusCanvas).toBe(2);
  });
});

/**
 * Block 1 studio design tokens — typed surface over designTokens.json.
 *
 * The JSON file is the single source of truth (design brief §1); this module
 * gives every consumer the same typed view of it:
 *   • web — `scripts/gen-tokens.mjs` reads the JSON and generates
 *     `apps/web/app/tokens.css` (CSS custom properties, dark/light/print);
 *   • mobile — imports these exports directly via `apps/mobile/theme/studio.ts`.
 *
 * Parity between platforms is therefore by construction, not by review.
 */

import tokens from './designTokens.json';

/** One theme's semantic values (hex). Camel-cased view of the CSS var names. */
export interface StudioTheme {
  readonly page: string;
  readonly chrome1: string;
  readonly chrome2: string;
  readonly hairline: string;
  readonly textHi: string;
  readonly textMid: string;
  readonly textLow: string;
  readonly paper: string;
  readonly paperEdge: string;
  readonly accentState: string;
  readonly accentLive: string;
  readonly danger: string;
}

export type StudioThemeName = 'dark' | 'light';

type RawTheme = (typeof tokens)['themes']['dark'];

function toTheme(raw: RawTheme): StudioTheme {
  return {
    page: raw.page,
    chrome1: raw['chrome-1'],
    chrome2: raw['chrome-2'],
    hairline: raw.hairline,
    textHi: raw['text-hi'],
    textMid: raw['text-mid'],
    textLow: raw['text-low'],
    paper: raw.paper,
    paperEdge: raw['paper-edge'],
    accentState: raw['accent-state'],
    accentLive: raw['accent-live'],
    danger: raw.danger,
  };
}

export const studioThemes: Readonly<Record<StudioThemeName, StudioTheme>> = {
  dark: toTheme(tokens.themes.dark),
  light: toTheme(tokens.themes.light),
};

/** 8px-grid layout constants (§2): zone sizes, control heights, radii. */
export const studioLayout = tokens.layout;

// ── Confidence ink (§3) ──────────────────────────────────────────────────────
// Theme-independent: engraved notes are always ink-black on paper, opacity
// graded by transcription confidence. Never inverted to white-on-dark.

export type ConfidenceTier = 'high' | 'mid' | 'low';

export const CONFIDENCE_INK: string = tokens.confidence.ink;

export const CONFIDENCE_TIERS: Readonly<
  Record<ConfidenceTier, { readonly min: number; readonly alpha: number }>
> = tokens.confidence.tiers;

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= CONFIDENCE_TIERS.high.min) return 'high';
  if (confidence >= CONFIDENCE_TIERS.mid.min) return 'mid';
  return 'low';
}

/** Ink opacity for a confidence value — the fill-opacity of the note glyph. */
export function confidenceAlpha(confidence: number): number {
  return CONFIDENCE_TIERS[confidenceTier(confidence)].alpha;
}

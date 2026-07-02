/**
 * Color system — the visual identity of the archive (ARCHITECTURE.md §7).
 *
 * Design intent: "archival dignity meets modern clarity." Dark-mode primary, warm
 * materials, amber used sparingly as the single signature accent (oud wood). These
 * are the canonical design tokens referenced in CLAUDE.md — do not hardcode hex
 * values anywhere in the app; always import from here.
 *
 * `as const` freezes the literal values so a typo like `colors.amber.primry` is a
 * compile error, and every hex string keeps its literal type for tooling.
 */

export const colors = {
  // Backgrounds — dark primary, building toward light.
  bg: {
    primary: '#0C0B14', // near-black with a warm purple undertone
    secondary: '#161524', // card surfaces
    tertiary: '#201E33', // elevated elements, modals
    inverse: '#EDE9DC', // light mode / onboarding
  },

  // Accent — oud-wood amber, the signature color. Used sparingly: CTAs, active
  // states, highlights.
  amber: {
    primary: '#C89B5F', // main accent — oud wood
    light: '#E5C48A', // hover / pressed states
    dim: '#7A5C2E', // secondary text on amber bg
    subtle: '#2A1F0E', // amber-tinted surface
  },

  // Secondary accent — Somali flag blue.
  blue: {
    primary: '#4189D4', // links, secondary actions
    light: '#6BABEC',
    dim: '#1A4B82',
    subtle: '#0A1E38',
  },

  // Semantic colors.
  success: '#5AB88A',
  warning: '#E8B84B',
  error: '#E05A5A',
  info: '#5A9BE0',

  // Text.
  text: {
    primary: '#EDE9DC', // main body text — warm white
    secondary: '#9B97B0', // labels, metadata, placeholders
    tertiary: '#5C5A74', // disabled states
    inverse: '#0C0B14', // text on light backgrounds
  },

  // Borders.
  border: {
    primary: '#2D2B45',
    secondary: '#1E1D30',
    focus: '#C89B5F', // always amber on focus
  },

  // Always-static (never changes in dark/light).
  static: {
    white: '#FFFFFF',
    black: '#000000',
    // Scrims for modals/overlays.
    scrim: 'rgba(12, 11, 20, 0.72)',
  },
} as const;

export type Colors = typeof colors;

/**
 * Spacing system (ARCHITECTURE.md §7, CLAUDE.md design tokens).
 *
 * Base unit: 4px. Every margin, padding, and gap in the app is a value from this
 * scale — never a raw number. A 4px grid keeps rhythm consistent across screens
 * built by different people over the life of the project.
 */

export const spacing = {
  xs: 4, // tight internal padding
  sm: 8, // between related elements
  md: 12, // standard internal card padding
  base: 16, // default horizontal screen padding
  lg: 20, // between sections within a card
  xl: 24, // between major sections
  xxl: 32, // major layout gaps
  xxxl: 48, // hero sections, top padding
} as const;

export type Spacing = typeof spacing;
export type SpacingToken = keyof typeof spacing;

/**
 * Border radii. Kept alongside spacing because they share the same rhythm and are
 * consumed together when composing cards, buttons, and chips.
 */
export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999, // fully rounded (chips, avatars, the record button)
} as const;

export type RadiusToken = keyof typeof radius;

/** Minimum interactive touch target (ARCHITECTURE.md §7 Accessibility — 44×44pt). */
export const MIN_TOUCH_TARGET = 44;

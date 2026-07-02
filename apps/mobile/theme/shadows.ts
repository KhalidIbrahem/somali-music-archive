/**
 * Elevation / shadow tokens (ARCHITECTURE.md §6 theme).
 *
 * iOS and Android render shadows through completely different APIs (`shadow*`
 * props vs. `elevation`). Each token sets BOTH so a component elevates correctly
 * on either platform without per-screen branching. On the near-black background,
 * shadows are subtle — depth comes mostly from the surface color steps in
 * `colors.bg`, with shadow as a gentle reinforcement.
 */

import type { ViewStyle } from 'react-native';

type Shadow = Required<
  Pick<ViewStyle, 'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'>
>;

export const shadows = {
  none: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.24,
    shadowRadius: 6,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 12,
  },
} as const satisfies Record<string, Shadow>;

export type ShadowToken = keyof typeof shadows;

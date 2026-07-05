/**
 * PitchContour — the melodic pitch line of a recording (SESSION P3-06).
 *
 * Renders the CREPE pitch track (mapped to the Somali scale by the AI service) as
 * a compact amber sparkline: time on x, normalised pitch on y. The heavy lifting —
 * dropping silent frames, downsampling, normalising — is done by buildPitchContour
 * in utils/pitch, so this stays a thin SVG wrapper. A `viewBox` lets the line scale
 * to whatever width the container gives it.
 */

import { StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import type { ContourPoint } from '@/utils/pitch';
import { colors, radius, spacing } from '@/theme';

export interface PitchContourProps {
  points: ContourPoint[];
  height?: number;
}

// Internal viewBox units; the SVG scales to the container width (aspect ignored).
const VB_W = 100;
const VB_H = 100;
const PAD = 6; // keep the line off the very top/bottom edges

export function PitchContour({ points, height = 72 }: PitchContourProps): React.JSX.Element | null {
  if (points.length < 2) return null;

  const polyline = points
    .map((p) => {
      const x = p.x * VB_W;
      // Invert y (SVG origin is top-left) and inset by PAD.
      const y = PAD + (1 - p.y) * (VB_H - PAD * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <View style={[styles.wrapper, { height }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
        <Polyline
          points={polyline}
          fill="none"
          stroke={colors.amber.primary}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.bg.tertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
});

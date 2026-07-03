/**
 * GeometricStar — the five-pointed star that is the platform's signature mark
 * (ARCHITECTURE.md §7: "a five-pointed star geometry that mirrors the five-note
 * pentatonic scale"). Pure, static SVG in oud-wood amber; motion is applied by the
 * parent (wrap it in an Animated.View), keeping this component simple and reusable.
 */

import Svg, { Polygon, Circle } from 'react-native-svg';
import { colors } from '@/theme';

export interface GeometricStarProps {
  /** Rendered width/height in px. */
  size?: number;
  color?: string;
}

/** Build the 10-vertex point list for a 5-point star inscribed in `size`. */
function starPoints(size: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2;
  const inner = outer * 0.4; // classic 5-point star inner/outer ratio
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    // Start at the top point (-90°) and step every 36°.
    const angle = (-90 + i * 36) * (Math.PI / 180);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(' ');
}

export function GeometricStar({
  size = 160,
  color = colors.amber.primary,
}: GeometricStarProps): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Faint halo to echo the "animating outward from a single center point". */}
      <Circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={colors.amber.subtle} />
      <Polygon
        points={starPoints(size)}
        fill={color}
        stroke={colors.amber.light}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

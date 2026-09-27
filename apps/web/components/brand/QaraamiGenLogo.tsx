/**
 * QaraamiGenAI identity — the "Q string" mark (website-v1, 2026-09-27).
 *
 * A letter Q whose tail is a sounding kaban (oud) string: the ring opens at the
 * lower right and the tail leaves it as a vibration. Three variations share the
 * same ring so the wordmark lockup never moves:
 *   • wave   — the tail is a waveform (the recording leaving the letter)
 *   • string — the tail is a plucked string drawn with its vibration envelope
 *   • through — the string runs horizontally through the Q; the tail is a plain stroke
 *
 * Ring rides currentColor; the string/wave rides the accent token in duo tone
 * (mono puts everything on currentColor for stamps and print). Strokes thicken
 * as the mark shrinks so the favicon and the 26 px header mark stay legible.
 *
 * Standalone SVG exports of all three: apps/web/public/brand/.
 */

export type MarkVariant = 'wave' | 'string' | 'through';

/** The variation the site uses everywhere (header, favicon, footer). */
export const DEFAULT_MARK_VARIANT: MarkVariant = 'wave';

// Ring: centre (50,50), radius 34, open between 20° and 70° (lower right).
const RING_OPEN = 'M70.06 88.44 A38 38 0 1 1 88.44 70.06';

// Wave tail, drawn along x then rotated 45° about the ring centre.
const WAVE_FULL = 'M20 0 H28 L36 -11 L48 11 L58 -8 L64 0 H70';
const WAVE_SMALL = 'M18 0 H28 L38 -13 L52 13 L62 0 H70';

// String tail: the straight string plus its vibration envelope (a lens).
const STRING_LINE = 'M20 0 H68';
const STRING_LENS = 'M28 0 C40 -9 56 -9 66 0 C56 9 40 9 28 0 Z';

// Plain tail (variation through) and the string across the centre.
const RING_TAIL = 'M73.8 73.8 L95.01 95.01';
const THROUGH_FULL = 'M-42 0 H-26 L-18 -10 L-6 10 L6 -10 L18 10 L26 0 H42';
const THROUGH_SMALL = 'M-42 0 H-24 L-10 -13 L10 13 L24 0 H42';

export function QaraamiGenMark({
  size = 32,
  tone = 'duo',
  variant = DEFAULT_MARK_VARIANT,
  className,
}: {
  size?: number;
  /** duo: string/wave in the accent token; mono: everything currentColor. */
  tone?: 'duo' | 'mono';
  variant?: MarkVariant;
  className?: string | undefined;
}): React.JSX.Element {
  const accent = tone === 'duo' ? 'var(--accent-state)' : 'currentColor';
  const small = size < 40;
  const stroke = small ? 12 : 10;
  // The vibration is drawn lighter than the ring so its period stays legible.
  const waveStroke = small ? 9 : 7;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {variant === 'wave' && (
        <>
          <path d={RING_OPEN} />
          <path
            d={small ? WAVE_SMALL : WAVE_FULL}
            transform="rotate(45 54 54) translate(54 54)"
            stroke={accent}
            strokeWidth={waveStroke}
          />
        </>
      )}
      {variant === 'string' && (
        <>
          <path d={RING_OPEN} />
          <g transform="rotate(45 54 54) translate(54 54)" stroke={accent}>
            <path d={STRING_LINE} />
            <path d={STRING_LENS} strokeWidth={small ? 5 : 3.5} opacity={small ? 1 : 0.85} />
          </g>
        </>
      )}
      {variant === 'through' && (
        <>
          <path d={RING_OPEN} />
          <path d={RING_TAIL} />
          <path
            d={small ? THROUGH_SMALL : THROUGH_FULL}
            transform="translate(54 54)"
            stroke={accent}
            strokeWidth={waveStroke}
          />
        </>
      )}
    </svg>
  );
}

export function QaraamiGenLockup({
  markSize = 36,
  strapline = false,
  className,
}: {
  markSize?: number;
  /** Adds the mono "Somali music archive" line under the wordmark. */
  strapline?: boolean;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ''}`}>
      <QaraamiGenMark size={markSize} />
      <span className="flex flex-col gap-0.5">
        <span
          className="font-display leading-none tracking-[0.02em]"
          style={{ fontSize: Math.round(markSize * 0.62) }}
        >
          Qaraami<span className="text-accent-state">GenAI</span>
        </span>
        {strapline && (
          <span className="numeric text-[10px] tracking-[0.28em] text-low uppercase">
            Somali music archive
          </span>
        )}
      </span>
    </span>
  );
}

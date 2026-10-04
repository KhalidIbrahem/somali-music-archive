/**
 * QaraamiGenAI brand mark and lockup.
 *
 * Mark: Circular open ring letter Q with resonant sound wave crossing tail,
 * in theme-aware duo-tone (currentColor / var(--accent-state)).
 * Wordmark: Original serif font (Playfair Display) set as "QaraamiGenAI".
 */

export type MarkVariant = 'wave' | 'heritage' | 'string' | 'through';

export const DEFAULT_MARK_VARIANT: MarkVariant = 'wave';

const RING_OPEN = 'M70.06 88.44 A38 38 0 1 1 88.44 70.06';
const WAVE_FULL = 'M20 0 H28 L36 -11 L48 11 L58 -8 L64 0 H70';
const WAVE_SMALL = 'M18 0 H28 L38 -13 L52 13 L62 0 H70';

export function QaraamiGenMark({
  size = 30,
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
  void variant;
  const accent = tone === 'duo' ? 'var(--accent-state)' : 'currentColor';
  const small = size < 40;
  const stroke = small ? 7 : 5;
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
      <path d={RING_OPEN} />
      <path
        d={small ? WAVE_SMALL : WAVE_FULL}
        transform="rotate(45 54 54) translate(54 54)"
        stroke={accent}
        strokeWidth={waveStroke}
      />
    </svg>
  );
}

export function QaraamiGenLockup({
  markSize = 30,
  strapline = false,
  className,
}: {
  markSize?: number;
  /** Adds the "Somali music archive" line under the wordmark. */
  strapline?: boolean;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <QaraamiGenMark size={markSize} />
      <span className="flex flex-col justify-center leading-none">
        <span
          className="font-display tracking-wide text-hi"
          style={{ fontSize: Math.round(markSize * 0.62) }}
        >
          Qaraami<span className="text-accent-state">GenAI</span>
        </span>
        {strapline && (
          <span className="numeric text-[9px] tracking-[0.24em] text-mid uppercase mt-0.5">
            Somali Music Archive
          </span>
        )}
      </span>
    </span>
  );
}

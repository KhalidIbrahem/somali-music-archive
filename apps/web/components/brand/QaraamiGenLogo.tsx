/**
 * QaraamiGenAI identity — 100-Year Heritage Brand Mark (Q-Seal).
 *
 * An authoritative institutional archive seal:
 *   • The letterform Q embodies the circular soundbox of the Somali Kaban (oud).
 *   • Inner concentric bead ring giving numismatic and archival authority.
 *   • Internal acoustic strings reflecting the Kaban's courses.
 *   • Central 8-pointed Somali star rosette inspired by vintage kaban soundholes.
 *   • The bold diagonal tail cuts through the lower-right quadrant like a striking
 *     risha (plectrum), carrying oral music into permanent memory.
 */

export type MarkVariant = 'heritage' | 'wave' | 'string' | 'through';

/** The variation the site uses everywhere (header, favicon, footer). */
export const DEFAULT_MARK_VARIANT: MarkVariant = 'heritage';

// Previous variants retained for compatibility
const RING_OPEN = 'M70.06 88.44 A38 38 0 1 1 88.44 70.06';
const WAVE_FULL = 'M20 0 H28 L36 -11 L48 11 L58 -8 L64 0 H70';
const WAVE_SMALL = 'M18 0 H28 L38 -13 L52 13 L62 0 H70';
const STRING_LINE = 'M20 0 H68';
const STRING_LENS = 'M28 0 C40 -9 56 -9 66 0 C56 9 40 9 28 0 Z';
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
  const stroke = small ? 7 : 5;
  const stringStroke = small ? 2.5 : 1.75;
  const tailStroke = small ? 9 : 7;

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
      {variant === 'heritage' && (
        <>
          {/* Outer Archival Seal Ring */}
          <circle cx="56" cy="52" r="40" stroke="currentColor" strokeWidth={stroke} />
          {/* Inner Numismatic Bead Ring */}
          <circle
            cx="56"
            cy="52"
            r="33"
            stroke={accent}
            strokeWidth={stringStroke}
            strokeDasharray={small ? 'none' : '3 3'}
            opacity={small ? 0.7 : 0.85}
          />
          {/* Kaban Strings (Acoustic Chamber) */}
          <path
            d="M44 32 V72 M56 22 V82 M68 32 V72"
            stroke="currentColor"
            strokeWidth={stringStroke}
            strokeLinecap="round"
            opacity={0.5}
          />
          {/* Central Somali 8-Pointed Star Rosette */}
          <polygon
            points="56,44 58.5,49.5 64,52 58.5,54.5 56,60 53.5,54.5 48,52 53.5,49.5"
            fill={accent}
            stroke="none"
          />
          {/* Authoritative Q Tail (Resonant Plectrum Stroke) */}
          <path d="M56 52 L94 94" stroke={accent} strokeWidth={tailStroke} strokeLinecap="round" />
          <circle cx="94" cy="94" r={small ? 4 : 3} fill={accent} stroke="none" />
        </>
      )}
      {variant === 'wave' && (
        <>
          <path d={RING_OPEN} />
          <path
            d={small ? WAVE_SMALL : WAVE_FULL}
            transform="rotate(45 54 54) translate(54 54)"
            stroke={accent}
            strokeWidth={small ? 9 : 7}
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
            strokeWidth={small ? 9 : 7}
          />
        </>
      )}
    </svg>
  );
}

export function QaraamiGenLockup({
  markSize = 34,
  strapline = true,
  className,
}: {
  markSize?: number;
  /** Adds the "Somali music archive" line under the wordmark. */
  strapline?: boolean;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ''}`}>
      <QaraamiGenMark size={markSize} />
      <span className="flex flex-col justify-center leading-none">
        <span
          className="font-display font-bold tracking-[0.06em] text-hi"
          style={{ fontSize: Math.round(markSize * 0.58) }}
        >
          QARAAMI<span className="text-accent-state font-normal ml-0.5">GEN</span>
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

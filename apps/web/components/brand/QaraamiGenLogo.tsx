/**
 * QaraamiGenAI identity — concept 1A "The Seal" from the identity study
 * (fixtures/qaraamigen-logo.fixture.html, the identity study committed
 * 2026-08-06).
 *
 * Five kaban strings held inside an archive stamp; the centre string breaks
 * into waveform and runs past the ring — the recording escaping the artifact.
 *
 * The study ships size-specific redraws (strings drop and strokes thicken as
 * the mark shrinks) rather than one scaled drawing; this component keeps that
 * behaviour. Ring/strings ride currentColor; the waveform rides the
 * accent-state token in duo tone (so light theme gets the AA-safe brass
 * automatically — the one deliberate deviation from the study's static cream
 * sheet, which set the light lockup in single ink).
 */

const WAVE = {
  full: 'M4 60 H40 L46 48 L52 74 L58 54 L64 66 L70 60 H116',
  mid: 'M4 60 H42 L50 48 L58 74 L66 56 L72 60 H116',
  small: 'M6 60 H44 L52 46 L60 76 L68 56 L74 60 H114',
  tiny: 'M8 60 H44 L52 44 L60 78 L68 54 L74 60 H112',
} as const;

type MarkDetail = keyof typeof WAVE;

function detailForSize(size: number): MarkDetail {
  if (size >= 72) return 'full';
  if (size >= 48) return 'mid';
  if (size >= 24) return 'small';
  return 'tiny';
}

export function QaraamiGenMark({
  size = 32,
  tone = 'duo',
  className,
}: {
  size?: number;
  /** duo: waveform in accent-state; mono: everything currentColor (stamps, print). */
  tone?: 'duo' | 'mono';
  className?: string | undefined;
}): React.JSX.Element {
  const detail = detailForSize(size);
  const wave = tone === 'duo' ? 'var(--accent-state)' : 'currentColor';
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={className}
    >
      {detail === 'full' && (
        <g strokeWidth={3}>
          <circle cx="60" cy="60" r="46" />
          <path d="M28 40 H92 M24 50 H96" />
          <path d="M24 70 H96 M28 80 H92" />
          <path d={WAVE.full} stroke={wave} />
        </g>
      )}
      {detail === 'mid' && (
        <g strokeWidth={4}>
          <circle cx="60" cy="60" r="46" />
          <path d="M28 42 H92 M24 51 H96" />
          <path d="M24 69 H96 M28 78 H92" />
          <path d={WAVE.mid} stroke={wave} />
        </g>
      )}
      {detail === 'small' && (
        <g strokeWidth={7}>
          <circle cx="60" cy="60" r="44" />
          <path d="M26 42 H94" />
          <path d="M26 78 H94" />
          <path d={WAVE.small} stroke={wave} />
        </g>
      )}
      {detail === 'tiny' && (
        <g strokeWidth={10}>
          <circle cx="60" cy="60" r="42" />
          <path d={WAVE.tiny} stroke={wave} />
        </g>
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

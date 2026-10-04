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



export function QaraamiGenMark({
  size = 32,
  className,
}: {
  size?: number;
  tone?: 'duo' | 'mono';
  variant?: MarkVariant | 'icon';
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 overflow-hidden rounded-full ring-1 ring-accent-state/35 shadow-[0_0_12px_rgba(200,155,95,0.22)] bg-[#0B0C0E] select-none ${className ?? ''}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <img
        src="/images/qaraami-q-icon.png"
        alt="QaraamiGenAI — Golden String-to-Wave Fusion Q"
        width={size}
        height={size}
        className="h-full w-full object-cover select-none pointer-events-none"
        loading="eager"
      />
    </span>
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
          QARAAMI<span className="text-accent-state font-normal ml-0.5">GEN</span><span className="text-accent-state font-bold ml-0.5">AI</span>
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

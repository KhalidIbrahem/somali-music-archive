/**
 * SiteFooter — the author's footer, shared by every public page (website-v1).
 * Content verbatim from lib/siteCopy.ts. Layout: two columns from md up
 * (identity left, the three profile buttons right), one centred column below;
 * a hairline; the rights strip. Ink by default, the gold accent on hover only.
 */

import { QaraamiGenMark } from '@/components/brand/QaraamiGenLogo';
import { siteCopy } from '@/lib/siteCopy';

const { footer } = siteCopy;

const ICON: Record<(typeof footer.socials)[number]['label'], React.JSX.Element> = {
  GitHub: (
    <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
  ),
  LinkedIn: (
    <path d="M6.94 8.5H3.56V20h3.38V8.5ZM5.25 3.5a1.96 1.96 0 1 0 0 3.92 1.96 1.96 0 0 0 0-3.92ZM20.44 13c0-3.3-1.76-4.83-4.1-4.83-1.9 0-2.75 1.04-3.22 1.77V8.5H9.75c.04.95 0 11.5 0 11.5h3.37v-6.42c0-.34.03-.69.13-.93.28-.69.92-1.4 1.98-1.4 1.4 0 1.96 1.07 1.96 2.63V20h3.37l-.12-7Z" />
  ),
  X: (
    <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.16h1.7L7.4 4.74H5.58l11.09 14.42Z" />
  ),
};

function MailIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function PinIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 21s-6-5.33-6-10a6 6 0 0 1 12 0c0 4.67-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2.2" />
    </svg>
  );
}

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="relative z-10 border-t border-line-secondary bg-bg-primary">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-10 px-4 pt-14 pb-12 text-center sm:px-6 md:flex-row md:items-start md:justify-between md:text-left">
        {/* Identity */}
        <div className="flex min-w-0 flex-col items-center gap-4 md:items-start">
          <div className="flex items-center gap-3">
            <QaraamiGenMark size={30} className="shrink-0 text-ink-primary" />
            <p className="font-display text-xl tracking-wide text-ink-primary">{footer.name}</p>
          </div>
          <p className="max-w-md font-body text-sm leading-relaxed text-ink-secondary">
            {footer.line}
          </p>
          <ul className="flex flex-col items-center gap-2 font-body text-sm text-ink-secondary md:items-start">
            <li>
              <a
                href={`mailto:${footer.email}`}
                className="inline-flex min-h-8 items-center gap-2 rounded-[4px] break-all transition-colors hover:text-amber focus-visible:ring-2 focus-visible:ring-blueflag focus-visible:outline-none"
              >
                <span className="shrink-0 text-ink-tertiary">
                  <MailIcon />
                </span>
                {footer.email}
              </a>
            </li>
            <li className="inline-flex min-h-8 items-center gap-2">
              <span className="shrink-0 text-ink-tertiary">
                <PinIcon />
              </span>
              {footer.location}
            </li>
          </ul>
        </div>

        {/* Profiles */}
        <nav aria-label="Profiles" className="flex items-center gap-3 md:pt-1">
          {footer.socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="me noreferrer"
              aria-label={`${s.label}: ${s.handle} (opens in a new tab)`}
              title={s.handle}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line-primary text-ink-secondary transition-colors hover:border-amber hover:text-amber focus-visible:ring-2 focus-visible:ring-blueflag focus-visible:outline-none"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                {ICON[s.label]}
              </svg>
            </a>
          ))}
        </nav>
      </div>

      <div className="border-t border-line-secondary">
        <p className="mx-auto w-full max-w-6xl px-4 py-5 text-center font-body text-xs leading-relaxed text-ink-tertiary sm:px-6 md:text-left">
          {footer.strip}
        </p>
      </div>
    </footer>
  );
}

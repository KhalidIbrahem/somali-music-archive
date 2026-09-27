/**
 * SiteFooter — the author's footer, shared by every public page (website-v1).
 * Name, one line, email, location, the three profiles, and the rights strip.
 * All strings come verbatim from lib/siteCopy.ts.
 */

import { QaraamiGenMark } from '@/components/brand/QaraamiGenLogo';
import { siteCopy } from '@/lib/siteCopy';

const { footer } = siteCopy;

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="relative z-10 border-t border-line-secondary bg-bg-primary">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <QaraamiGenMark size={24} className="shrink-0 text-ink-primary" />
            <p className="font-display text-lg text-ink-primary">{footer.name}</p>
          </div>
          <p className="mt-2 max-w-md font-body text-sm leading-relaxed text-ink-secondary">
            {footer.line}
          </p>
          <p className="mt-3 font-body text-sm text-ink-secondary">
            <a
              href={`mailto:${footer.email}`}
              className="break-all text-amber underline-offset-2 hover:underline"
            >
              {footer.email}
            </a>
            <span className="text-ink-tertiary"> · </span>
            {footer.location}
          </p>
        </div>
        <nav aria-label="Profiles" className="flex flex-col gap-2 md:items-end">
          {footer.socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="me noreferrer"
              className="flex min-h-11 items-center gap-2 font-body text-sm text-ink-secondary transition-colors hover:text-amber md:min-h-0"
            >
              <span className="text-ink-primary">{s.label}</span>
              <span className="text-ink-tertiary">{s.handle}</span>
            </a>
          ))}
        </nav>
      </div>
      <div className="border-t border-line-secondary">
        <p className="mx-auto w-full max-w-6xl px-4 py-4 font-body text-xs text-ink-tertiary sm:px-6">
          {footer.strip}
        </p>
      </div>
    </footer>
  );
}

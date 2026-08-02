/**
 * SiteHeader — the shared top navigation for the public pages (home, listen,
 * library). Sticky, translucent over the near-black surface, amber accents.
 */

import Link from 'next/link';

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'Listen', href: '/listen' },
  { label: 'Library', href: '/library' },
  { label: 'Transcribe', href: '/transcribe' },
  { label: 'Generate', href: '/generate' },
  { label: 'Research', href: '/#research' },
] as const;

export function SiteHeader({ active }: { active?: string }): React.JSX.Element {
  return (
    <header className="sticky top-0 z-20 border-b border-line-secondary bg-bg-primary/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="font-display text-lg tracking-wide text-ink-primary">
            Somali Music Archive
          </span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`font-body text-sm transition-colors hover:text-amber ${
                active === item.label ? 'text-amber' : 'text-ink-secondary'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <Link
          href="/login"
          className="rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
        >
          Sign in
        </Link>
      </nav>
    </header>
  );
}

export function LogoMark(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="#C89B5F" strokeWidth="1.5" />
      <path
        d="M9 8l7-2v8.5"
        stroke="#C89B5F"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="14.5" r="2" stroke="#C89B5F" strokeWidth="1.5" />
      <circle cx="14.5" cy="12.5" r="2" stroke="#C89B5F" strokeWidth="1.5" />
    </svg>
  );
}

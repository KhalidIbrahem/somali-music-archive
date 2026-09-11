/**
 * SiteHeader — the shared top navigation for the public pages (listen, scores,
 * library, transcribe, generate). Sticky, translucent, amber accents. The
 * theme toggle sits at the right on every page; the choice is stored in
 * localStorage and applied before first paint by the root layout's bootstrap
 * script (lib/theme.ts), with the system preference as the default.
 */

import Link from 'next/link';
import { QaraamiGenMark } from '@/components/brand/QaraamiGenLogo';
import { AuthMenu } from '@/components/AuthMenu';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { flags } from '@/lib/flags';

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'Studio', href: '/daw' },
  { label: 'Listen', href: '/listen' },
  { label: 'Scores', href: '/scores/beerdilaacshe' },
  { label: 'Library', href: '/library' },
  { label: 'Learn', href: '/learn' },
  { label: 'Courses', href: '/courses' },
  { label: 'Transcribe', href: '/transcribe' },
  { label: 'Generate', href: '/generate' },
  { label: 'Research', href: '/#research' },
] as const;

/** Nav items switched off by feature flags (lib/flags.ts). */
const HIDDEN = new Set<string>([
  ...(flags.daw ? [] : ['Studio']),
  ...(flags.learn ? [] : ['Learn']),
  ...(flags.courses ? [] : ['Courses']),
]);
const VISIBLE_NAV = NAV.filter((item) => !HIDDEN.has(item.label));

export function SiteHeader({ active }: { active?: string }): React.JSX.Element {
  return (
    <header className="sticky top-0 z-20 border-b border-line-secondary bg-bg-primary/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <QaraamiGenMark size={26} className="text-ink-primary" />
          <span className="font-display text-lg tracking-wide text-ink-primary">
            Qaraami<span className="text-amber">GenAI</span>
          </span>
        </Link>
        <div className="hidden items-center gap-5 lg:flex">
          {VISIBLE_NAV.map((item) => (
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
        <div className="flex items-center gap-3">
          {flags.requireAuth ? <AuthMenu variant="site" /> : null}
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}

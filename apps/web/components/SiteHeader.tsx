/**
 * SiteHeader — the shared top bar of every public page. Sticky, translucent,
 * amber accents. Lockup left; links (SiteNav: inline from md up, hamburger
 * panel below), the account corner when the site is invite-only, and the
 * theme toggle right. The nav list is the author's (lib/siteCopy.ts); items
 * behind feature flags (lib/flags.ts) are appended only when switched on.
 */

import Link from 'next/link';
import { QaraamiGenMark } from '@/components/brand/QaraamiGenLogo';
import { AuthMenu } from '@/components/AuthMenu';
import { SiteNav } from '@/components/SiteNav';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { flags } from '@/lib/flags';
import { siteCopy } from '@/lib/siteCopy';

const NAV = [
  ...siteCopy.nav,
  ...(flags.daw ? [{ label: 'Studio', href: '/daw' }] : []),
  ...(flags.learn ? [{ label: 'Learn', href: '/learn' }] : []),
  ...(flags.courses ? [{ label: 'Courses', href: '/courses' }] : []),
] as const;

export function SiteHeader({ active }: { active?: string }): React.JSX.Element {
  return (
    // z-30: the account menu and the mobile panel live inside this stacking
    // context and must sit above every page's main (z-10) and the player bar.
    <header className="sticky top-0 z-30 border-b border-line-secondary bg-bg-primary/85 backdrop-blur">
      <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-3 rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blueflag"
        >
          <QaraamiGenMark
            size={34}
            className="shrink-0 text-ink-primary transition-transform duration-300 group-hover:scale-105"
          />
          <div className="flex flex-col justify-center leading-none">
            <span className="truncate font-display text-lg font-bold tracking-[0.06em] text-ink-primary">
              QARAAMI<span className="text-amber font-normal ml-0.5">GEN</span><span className="text-amber font-bold ml-0.5">AI</span>
            </span>
            <span className="numeric text-[9px] tracking-[0.24em] text-ink-tertiary uppercase mt-0.5">
              Somali Music Archive
            </span>
          </div>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <SiteNav items={NAV} active={active} />
          {flags.requireAuth ? <AuthMenu variant="site" /> : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

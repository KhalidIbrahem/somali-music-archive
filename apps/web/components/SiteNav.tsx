'use client';

/**
 * SiteNav — the navigation links of the shared header, in two forms: an inline
 * row from the md breakpoint up, and below it a hamburger button that opens
 * the same links as a panel under the header (website-v1: the site was
 * unusable on phones because the links were simply hidden).
 *
 * The panel closes on link click, on Escape, on outside pointer-down and on
 * any route change. Touch targets are 44 px tall.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  readonly label: string;
  readonly href: string;
}

export function SiteNav({
  items,
  active,
}: {
  items: readonly NavItem[];
  active?: string | undefined;
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // The panel remembers the path it was opened on, so a navigation closes it
  // without an effect: it is open only while the path is still that one.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean): void => setOpenedOn(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpenedOn(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenedOn(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const linkClass = (label: string): string =>
    `font-body transition-colors hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blueflag ${
      active === label ? 'text-amber' : 'text-ink-secondary'
    }`;

  return (
    <div ref={rootRef} className="flex items-center md:contents">
      {/* Inline row — md and up */}
      <div className="hidden items-center gap-5 md:flex">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active === item.label ? 'page' : undefined}
            className={`${linkClass(item.label)} rounded-[4px] text-sm`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {/* Hamburger — below md */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-line-primary text-ink-primary transition-colors hover:border-amber/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blueflag md:hidden"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          {open ? <path d="M3 3l12 12M15 3L3 15" /> : <path d="M2 4.5h14M2 9h14M2 13.5h14" />}
        </svg>
      </button>

      {/* The panel — the same links, one per row, under the header */}
      <div
        id="site-menu"
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-line-secondary bg-bg-primary shadow-xl shadow-black/30 md:hidden"
      >
        <nav aria-label="Site" className="mx-auto flex max-w-6xl flex-col px-4 py-2">
          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={active === item.label ? 'page' : undefined}
              className={`${linkClass(item.label)} flex min-h-11 items-center rounded-[4px] px-2 text-base`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

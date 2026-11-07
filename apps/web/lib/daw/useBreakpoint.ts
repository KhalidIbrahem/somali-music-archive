'use client';

/**
 * Viewport breakpoints for the studio shell (Studio v3): the rails dock
 * beside the tracks area from `md` (768 px) and the inspector is shown by
 * default from `xl` (1280 px); below `md` every pane is an overlay.
 * SSR-safe: renders as desktop until the first client measurement.
 */

import { useEffect, useState } from 'react';

export interface Breakpoint {
  /** ≥ 768 px: rails dock instead of overlaying. */
  md: boolean;
  /** ≥ 1280 px: room for both rails and the tracks area. */
  xl: boolean;
}

const QUERIES = { md: '(min-width: 768px)', xl: '(min-width: 1280px)' } as const;

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>({ md: true, xl: true });
  useEffect(() => {
    const md = window.matchMedia(QUERIES.md);
    const xl = window.matchMedia(QUERIES.xl);
    const read = (): void => setBp({ md: md.matches, xl: xl.matches });
    read();
    md.addEventListener('change', read);
    xl.addEventListener('change', read);
    return () => {
      md.removeEventListener('change', read);
      xl.removeEventListener('change', read);
    };
  }, []);
  return bp;
}

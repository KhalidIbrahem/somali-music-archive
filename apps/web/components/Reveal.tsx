'use client';

/**
 * Reveal — scroll-triggered fade-up used across the marketing/listening pages.
 * Children stay invisible until the wrapper enters the viewport, then play the
 * shared fade-up curve (globals.css `.reveal`). Respects prefers-reduced-motion.
 */

import { useEffect, useRef, useState } from 'react';

export interface RevealProps {
  children: React.ReactNode;
  /** Stagger delay in ms, applied once the element becomes visible. */
  delay?: number;
  className?: string;
}

export function Reveal({ children, delay = 0, className }: RevealProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} ${className ?? ''}`}
      style={{ '--reveal-delay': `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

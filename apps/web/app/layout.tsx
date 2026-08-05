/**
 * Root layout (Next.js App Router). Loads the two brand fonts via next/font and
 * exposes them as CSS variables consumed by the Tailwind theme (font-display /
 * font-body). Dark, near-black background is the default surface (§7).
 */

import type { Metadata } from 'next';
import { Playfair_Display, Nunito, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-playfair',
  display: 'swap',
});

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-nunito',
  display: 'swap',
});

// Mono face for numeric readouts only — timecode, BPM, confidence %, Hz (§1).
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Somali Music Archive',
  description:
    'The first AI-powered archive of Somali traditional music. Preserved. Taught. Shared.',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={`${playfair.variable} ${nunito.variable} ${plexMono.variable}`}>
      {/* suppressHydrationWarning: browser extensions (ColorZilla et al.) inject
          attributes like cz-shortcut-listen into <body> before React hydrates,
          tripping a false mismatch warning. Scoped to this element only. */}
      <body className="font-body antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

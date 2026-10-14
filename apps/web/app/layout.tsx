/**
 * Root layout (Next.js App Router). Loads the two brand fonts via next/font and
 * exposes them as CSS variables consumed by the Tailwind theme (font-display /
 * font-body). Dark, near-black background is the default surface (§7).
 */

import type { Metadata } from 'next';
import { Playfair_Display, Nunito, IBM_Plex_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { InAppBrowserBanner } from '@/components/InAppBrowserBanner';
import { PlayerProvider } from '@/components/player/PlayerProvider';
import { PlayerBar } from '@/components/player/PlayerBar';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme';
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

const SITE_URL = 'https://qaraamigen.com';
const SITE_DESCRIPTION =
  'The world’s first Somali Music AI platform. Generate authentic Somali Qaraami songs, transcribe historical cassette recordings into sheet music, and compose with Kaban and Durbaan online.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Somali Music AI — QaraamiGenAI | The First Somali Music AI Platform',
    template: '%s | Somali Music AI — QaraamiGenAI',
  },
  description: SITE_DESCRIPTION,
  applicationName: 'Somali Music AI — QaraamiGenAI',
  keywords: [
    'somali music ai',
    'Somali Music AI',
    'Somali AI music generator',
    'somali ai music',
    'Somali music generator',
    'Somali music',
    'Somali songs',
    'qaraami',
    'Somali qaraami',
    'Somali oud',
    'kaban',
    'heello',
    'Radio Hargeisa',
    'Somali music archive',
    'Somali sheet music',
    'Somali music transcription',
    'Muusig Soomaali AI',
    'Hees Soomaali AI',
    'Khalid Ibrahim',
  ],
  authors: [{ name: 'Khalid Ibrahim', url: SITE_URL }],
  creator: 'Khalid Ibrahim',
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Somali Music AI — QaraamiGenAI',
    title: 'Somali Music AI — QaraamiGenAI | The First Somali Music AI Platform',
    description: SITE_DESCRIPTION,
    locale: 'en_US',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Somali Music AI — QaraamiGenAI Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Somali Music AI — QaraamiGenAI | The First Somali Music AI Platform',
    description: SITE_DESCRIPTION,
    images: ['/opengraph-image'],
    creator: '@khalid_ibrahm',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  alternates: {
    canonical: SITE_URL,
  },
  // Set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION in Vercel to the token Search Console gives you.
  ...(process.env['NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION']
    ? { verification: { google: process.env['NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION'] } }
    : {}),
};

/** schema.org data Google reads for the site name, owner, software app, and search box. */
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'Somali Music AI — QaraamiGenAI',
      alternateName: ['Somali Music AI', 'QaraamiGenAI', 'QaraamiGen', 'Somali AI Music Generator'],
      description: SITE_DESCRIPTION,
      inLanguage: 'en',
      publisher: { '@id': `${SITE_URL}/#person` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/listen?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#software`,
      name: 'Somali Music AI — QaraamiGenAI',
      alternateName: ['Somali Music AI', 'QaraamiGenAI', 'Somali AI Music Generator'],
      url: SITE_URL,
      applicationCategory: 'MultimediaApplication',
      applicationSubCategory: 'Music & Audio AI',
      operatingSystem: 'All modern web browsers',
      description:
        'The definitive Somali Music AI platform for generating, transcribing, and composing authentic Somali music, Qaraami, and Kaban (oud) audio.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      creator: { '@id': `${SITE_URL}/#person` },
    },
    {
      '@type': 'Person',
      '@id': `${SITE_URL}/#person`,
      name: 'Khalid Ibrahim',
      jobTitle: 'AI engineer & Founder',
      address: { '@type': 'PostalAddress', addressLocality: 'Minneapolis', addressRegion: 'MN' },
      sameAs: [
        'https://github.com/KhalidIbrahem',
        'https://linkedin.com/in/khalidibrahimabdi1',
        'https://x.com/khalid_ibrahm',
      ],
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    // suppressHydrationWarning on <html>: the theme bootstrap sets data-theme
    // before hydration, which the server render cannot know.
    <html
      lang="en"
      className={`${playfair.variable} ${nunito.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning on <body>: browser extensions (ColorZilla et
          al.) inject attributes like cz-shortcut-listen before React hydrates,
          tripping a false mismatch warning. Scoped to this element only. */}
      <body className="font-body antialiased" suppressHydrationWarning>
        {/* First statement the browser executes inside <body>: resolve the
            theme (stored choice → system preference → dark) before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        <ThemeProvider>
          <PlayerProvider>
            <InAppBrowserBanner />
            {children}
            <PlayerBar />
          </PlayerProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

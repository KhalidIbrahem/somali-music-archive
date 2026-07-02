import type { Config } from 'tailwindcss';

/**
 * Tailwind theme mapped to the platform design tokens (CLAUDE.md, ARCHITECTURE.md §7).
 * These MUST stay in sync with the mobile theme in apps/mobile/theme — same hex
 * values, same intent (oud-wood amber accent on near-black). Fonts are wired via
 * CSS variables set by next/font in app/layout.tsx.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0C0B14',
          secondary: '#161524',
          tertiary: '#201E33',
          inverse: '#EDE9DC',
        },
        amber: {
          DEFAULT: '#C89B5F',
          light: '#E5C48A',
          dim: '#7A5C2E',
          subtle: '#2A1F0E',
        },
        blueflag: {
          DEFAULT: '#4189D4',
          light: '#6BABEC',
          dim: '#1A4B82',
        },
        ink: {
          primary: '#EDE9DC',
          secondary: '#9B97B0',
          tertiary: '#5C5A74',
        },
        line: {
          primary: '#2D2B45',
          secondary: '#1E1D30',
        },
      },
      fontFamily: {
        display: ['var(--font-playfair)', 'serif'],
        body: ['var(--font-nunito)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;

import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Next.js config. `transpilePackages` lets Next compile the raw-TypeScript @sma/*
 * workspace packages directly (they ship .ts, not built JS), matching how Metro
 * and tsup consume them elsewhere in the monorepo.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['@sma/types', '@sma/constants', '@sma/validators'],
  turbopack: {
    resolveAlias: {
      // tone's package.json `browser` field points at the UMD bundle
      // (build/Tone.js), which Turbopack statically reads as having no exports —
      // breaking /transcribe via html-midi-player → @magenta/music → tone.
      // Pin the browser resolution to the real ESM build instead.
      tone: 'tone/build/esm/index.js',
    },
  },
};

export default nextConfig;

/**
 * Next.js config. `transpilePackages` lets Next compile the raw-TypeScript @sma/*
 * workspace packages directly (they ship .ts, not built JS), matching how Metro
 * and tsup consume them elsewhere in the monorepo.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sma/types', '@sma/constants', '@sma/validators'],
};

export default nextConfig;

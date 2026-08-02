import { defineConfig } from 'tsup';

/**
 * Production bundles. esbuild resolves and inlines the raw-TypeScript @sma/*
 * workspace packages (they ship as .ts, not compiled JS), so each emitted entry
 * is a self-contained ESM file that `node` runs directly — no ts-node/tsx needed
 * in production. Third-party deps stay external and are installed normally in
 * the runtime image.
 *
 * Two entries, one per deploy shape:
 *   • dist/server.js — long-lived process (Docker/VM): binds a port.
 *   • api/index.mjs  — Vercel serverless function: exports the Express app;
 *     the api/ directory name and .mjs extension are what Vercel's zero-config
 *     function detection expects.
 */
export default defineConfig([
  {
    entry: ['src/server.ts'],
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: true,
    sourcemap: true,
    // Bundle the internal workspace packages; leave node_modules external.
    noExternal: [/@sma\//],
  },
  {
    entry: { index: 'src/vercel.ts' },
    outDir: 'api',
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: true,
    // No sourcemap: Vercel's function builder follows map sources back to the
    // raw .ts files and type-checks them with its own (incompatible) settings.
    sourcemap: false,
    noExternal: [/@sma\//],
    outExtension: () => ({ js: '.mjs' }),
  },
]);

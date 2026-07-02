import { defineConfig } from 'tsup';

/**
 * Production bundle. esbuild resolves and inlines the raw-TypeScript @sma/*
 * workspace packages (they ship as .ts, not compiled JS), so the emitted
 * `dist/server.js` is a self-contained ESM entry that `node` runs directly —
 * no ts-node/tsx needed in production. Third-party deps stay external and are
 * installed normally in the runtime image.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle the internal workspace packages; leave node_modules external.
  noExternal: [/@sma\//],
});

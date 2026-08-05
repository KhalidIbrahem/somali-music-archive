/**
 * Type declarations for the verovio npm package's subpath exports (the
 * package ships none for them). Only the surface the studio uses is typed;
 * extend here rather than casting at call sites.
 */

declare module 'verovio/wasm' {
  /** Opaque Emscripten module handle passed to VerovioToolkit. */
  export interface VerovioModule {
    [key: string]: unknown;
  }
  const createVerovioModule: () => Promise<VerovioModule>;
  export default createVerovioModule;
}

declare module 'verovio/esm' {
  import type { VerovioModule } from 'verovio/wasm';

  export class VerovioToolkit {
    constructor(module: VerovioModule);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    redoLayout(options?: Record<string, unknown>): void;
    renderToSVG(page: number): string;
    getMEI(options?: Record<string, unknown>): string;
    getPageCount(): number;
  }
}

/**
 * One shared Verovio toolkit (WASM, loaded on first use, client side). Engraves
 * MusicXML to SVG pages and renders it to MIDI, all in the browser.
 */

import type { VerovioToolkit } from 'verovio/esm';

let toolkitPromise: Promise<VerovioToolkit> | null = null;

export function getToolkit(): Promise<VerovioToolkit> {
  toolkitPromise ??= (async () => {
    const [{ default: createVerovioModule }, { VerovioToolkit: Toolkit }] = await Promise.all([
      import('verovio/wasm'),
      import('verovio/esm'),
    ]);
    return new Toolkit(await createVerovioModule());
  })();
  return toolkitPromise;
}

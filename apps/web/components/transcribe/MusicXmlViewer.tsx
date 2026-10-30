'use client';

/**
 * MusicXmlViewer — open a MusicXML file from this computer (.musicxml / .xml,
 * or compressed .mxl), see it engraved, and listen to it. Everything runs in
 * the browser: Verovio (WASM) engraves the score and renders it to MIDI, and
 * <midi-player> plays that MIDI with a piano sound font. Nothing is uploaded.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getToolkit } from '@/lib/verovio';

const ACCEPT =
  '.musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml';
const MAX_BYTES = 20 * 1024 * 1024;
const SOUND_FONT = 'https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus';

interface Engraved {
  name: string;
  pages: string[];
  midiDataUrl: string;
}

function options(zoom: number): Record<string, unknown> {
  return {
    scale: Math.round(40 * zoom),
    pageWidth: 2100,
    adjustPageHeight: true,
    breaks: 'auto',
    footer: 'none',
    header: 'auto',
  };
}

export function MusicXmlViewer(): React.JSX.Element {
  const [score, setScore] = useState<Engraved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);

  useEffect(() => {
    // registers the <midi-player> custom element (client only)
    void import('html-midi-player').then(() => setPlayerReady(true));
  }, []);

  const engrave = useCallback(async (file: File, z: number): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (file.size > MAX_BYTES) throw new Error('That file is over 20 MB.');
      const toolkit = await getToolkit();
      toolkit.setOptions(options(z));
      const compressed = /\.mxl$/i.test(file.name);
      const ok = compressed
        ? toolkit.loadZipDataBuffer(await file.arrayBuffer())
        : toolkit.loadData(await file.text());
      if (!ok) throw new Error('This file could not be read as MusicXML.');
      const count = toolkit.getPageCount();
      if (count < 1) throw new Error('The file has no music in it.');
      const pages: string[] = [];
      for (let p = 1; p <= count; p++) pages.push(toolkit.renderToSVG(p));
      const midi = toolkit.renderToMIDI();
      setScore({
        name: file.name.replace(/\.(musicxml|xml|mxl)$/i, ''),
        pages,
        midiDataUrl: `data:audio/midi;base64,${midi}`,
      });
    } catch (e) {
      setScore(null);
      setError(e instanceof Error ? e.message : 'Something went wrong reading the file.');
    } finally {
      setBusy(false);
    }
  }, []);

  const open = (file: File | undefined): void => {
    if (!file) return;
    lastFile.current = file;
    void engrave(file, zoom);
  };

  const rezoom = (next: number): void => {
    const z = Math.min(2, Math.max(0.5, Math.round(next * 10) / 10));
    setZoom(z);
    if (lastFile.current) void engrave(lastFile.current, z);
  };

  return (
    <section
      aria-labelledby="musicxml-heading"
      className="mt-10 rounded-2xl border border-line-secondary bg-bg-secondary p-6"
    >
      <h2 id="musicxml-heading" className="font-display text-2xl text-ink-primary">
        Open a MusicXML score
      </h2>
      <p className="mt-1 max-w-2xl font-body text-sm text-ink-secondary">
        Open a score you downloaded (MusicXML: .musicxml, .xml or compressed .mxl) to see the sheet
        music and listen to it. It opens in your browser only; nothing is uploaded.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          open(e.dataTransfer.files[0]);
        }}
        className={`mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-5 py-4 transition-colors ${
          dragging ? 'border-amber bg-bg-tertiary' : 'border-line-primary'
        }`}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
        >
          Choose a MusicXML file…
        </button>
        <span className="font-body text-sm text-ink-tertiary">or drop it here</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            open(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {busy ? (
          <span role="status" className="font-body text-sm text-ink-secondary">
            Engraving…
          </span>
        ) : null}
      </div>

      {error !== null ? (
        <p role="alert" className="mt-3 font-body text-sm text-danger">
          {error}
        </p>
      ) : null}

      {score !== null ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-display text-xl text-ink-primary">{score.name}</h3>
            <span className="font-body text-xs text-ink-tertiary">
              {score.pages.length} {score.pages.length === 1 ? 'page' : 'pages'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => rezoom(zoom - 0.1)}
                className="h-8 w-8 rounded-lg border border-line-primary font-body text-ink-secondary hover:text-ink-primary"
              >
                −
              </button>
              <span className="w-12 text-center font-body text-xs text-ink-secondary">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => rezoom(zoom + 0.1)}
                className="h-8 w-8 rounded-lg border border-line-primary font-body text-ink-secondary hover:text-ink-primary"
              >
                +
              </button>
              <a
                href={score.midiDataUrl}
                download={`${score.name}.mid`}
                className="rounded-lg border border-line-primary px-3 py-1.5 font-body text-xs text-ink-secondary hover:text-ink-primary"
              >
                Download MIDI
              </a>
            </div>
          </div>
          {playerReady ? (
            <midi-player
              src={score.midiDataUrl}
              sound-font={SOUND_FONT}
              className="mt-3 block w-full"
            />
          ) : null}
          <div className="mt-4 flex flex-col gap-4">
            {score.pages.map((svg, i) => (
              <div
                key={i}
                aria-label={`Page ${i + 1}`}
                className="overflow-x-auto rounded-lg bg-bg-inverse p-4 ring-1 ring-line-primary [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
                // Verovio's own SVG output for a file the user opened locally.
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

'use client';

/**
 * BrowserTranscriber — Qormada on the visitor's own device. Choose a recording
 * or record one with the microphone; the melody's pitch is tracked in the
 * browser (lib/qormada/melody.ts: bass filtered out, octave slips fixed), the Somali pentatonic scale and the tuning are
 * fitted to the recording itself, and the melody is written as sheet music
 * (lib/qormada). Verovio engraves it and renders MIDI. Nothing is uploaded:
 * the audio never leaves this browser tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyseMelody, type MelodyAnalysis } from '@/lib/qormada/melody';
import type { TimedNote } from '@/lib/qormada/quantize';
import { buildSheet, melodyNotes } from '@/lib/qormada/sheet';
import { getToolkit } from '@/lib/verovio';

const MAX_BYTES = 60 * 1024 * 1024;
const MAX_SPAN_SEC = 600;
const SOUND_FONT = 'https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus';
const ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.webm,.opus';

interface Source {
  name: string;
  url: string;
  channels: Float32Array[];
  sampleRate: number;
  durationSec: number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'decoding' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'analysing'; progress: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

interface Engraved {
  pages: string[];
  midiDataUrl: string;
}

function tuningLabel(cents: number): string {
  const c = Math.round(cents);
  return `${c === 0 ? '±' : c > 0 ? '+' : '−'}${Math.abs(c)} c from A440`;
}

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function decode(
  blob: Blob,
): Promise<Pick<Source, 'channels' | 'sampleRate' | 'durationSec'>> {
  // An offline context decodes without needing a user gesture or a sound device.
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  return { channels, sampleRate: buffer.sampleRate, durationSec: buffer.duration };
}

export function BrowserTranscriber(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [source, setSource] = useState<Source | null>(null);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [analysis, setAnalysis] = useState<MelodyAnalysis | null>(null);
  const [notes, setNotes] = useState<TimedNote[]>([]);
  const [bpmText, setBpmText] = useState('');
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [transpose, setTranspose] = useState(0);
  const [showCents, setShowCents] = useState(true);
  const [includeOffScale, setIncludeOffScale] = useState(true);
  const [legato, setLegato] = useState(true);
  const [engraved, setEngraved] = useState<Engraved | null>(null);
  const [engraveError, setEngraveError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [playerReady, setPlayerReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    void import('html-midi-player').then(() => setPlayerReady(true));
    return () => {
      abortRef.current?.abort();
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  // Recording timer.
  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() - phase.startedAt > MAX_SPAN_SEC * 1000) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.preservesPitch = true;
      audioRef.current.playbackRate = speed;
    }
  }, [speed, source]);

  const load = useCallback(async (blob: Blob, name: string): Promise<void> => {
    abortRef.current?.abort();
    setAnalysis(null);
    setNotes([]);
    setEngraved(null);
    if (blob.size > MAX_BYTES) {
      setPhase({ kind: 'error', message: 'That file is over 60 MB. Try a shorter excerpt.' });
      return;
    }
    setPhase({ kind: 'decoding' });
    try {
      const decoded = await decode(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setSource({ name, url, ...decoded });
      setStartSec(0);
      setEndSec(Math.min(decoded.durationSec, MAX_SPAN_SEC));
      setPhase({ kind: 'idle' });
    } catch {
      setSource(null);
      setPhase({
        kind: 'error',
        message: 'This browser could not read that file as audio. MP3, WAV or M4A work everywhere.',
      });
    }
  }, []);

  const openFile = (file: File | undefined): void => {
    if (file) void load(file, file.name.replace(/\.[a-z0-9]+$/i, ''));
  };

  const startRecording = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Music, not a phone call: keep the sound as played.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
        const stamp = new Date().toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        void load(new Blob(chunks, { type: recorder.mimeType }), `Recording ${stamp}`);
      };
      recorderRef.current = recorder;
      recorder.start();
      setNow(Date.now());
      setPhase({ kind: 'recording', startedAt: Date.now() });
    } catch {
      setPhase({
        kind: 'error',
        message:
          'The microphone is not available. Allow microphone access for this site and try again.',
      });
    }
  };

  const analyse = async (): Promise<void> => {
    if (!source) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: 'analysing', progress: 0 });
    setEngraved(null);
    try {
      const result = await analyseMelody(
        source.channels,
        source.sampleRate,
        { startSec, endSec },
        {
          signal: controller.signal,
          onProgress: (progress) => setPhase({ kind: 'analysing', progress }),
        },
      );
      const melody = melodyNotes(result);
      setAnalysis(result);
      setNotes(melody);
      setBpmText('');
      setPhase(
        melody.length < 2
          ? {
              kind: 'error',
              message:
                'No clear melody was found in that part. Choose a part where one voice or instrument plays.',
            }
          : { kind: 'done' },
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setPhase({ kind: 'idle' });
      else setPhase({ kind: 'error', message: 'The analysis failed on this recording.' });
    }
  };

  const bpm = useMemo(() => {
    const n = Number(bpmText);
    return bpmText.trim() !== '' && Number.isFinite(n) && n >= 30 && n <= 240 ? n : null;
  }, [bpmText]);

  const sheet = useMemo(() => {
    if (!analysis || notes.length < 2 || !source) return null;
    return buildSheet(analysis, notes, {
      title: source.name,
      bpm,
      beatsPerBar,
      transpose,
      showCents,
      includeOffScale,
      legato,
    });
  }, [analysis, notes, source, bpm, beatsPerBar, transpose, showCents, includeOffScale, legato]);

  useEffect(() => {
    if (!sheet) return;
    let cancelled = false;
    void (async () => {
      try {
        const toolkit = await getToolkit();
        const narrow = window.innerWidth < 640;
        toolkit.setOptions({
          scale: Math.round(40 * zoom),
          pageWidth: narrow ? 1100 : 2100,
          adjustPageHeight: true,
          breaks: 'auto',
          footer: 'none',
          header: 'auto',
        });
        if (!toolkit.loadData(sheet.xml)) throw new Error('engrave');
        const pages: string[] = [];
        for (let p = 1; p <= toolkit.getPageCount(); p++) pages.push(toolkit.renderToSVG(p));
        const midi = toolkit.renderToMIDI();
        if (!cancelled) {
          setEngraved({ pages, midiDataUrl: `data:audio/midi;base64,${midi}` });
          setEngraveError(null);
        }
      } catch {
        if (!cancelled) setEngraveError('The score could not be drawn. Try other options.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheet, zoom]);

  const musicXmlUrl = useMemo(
    () =>
      sheet
        ? URL.createObjectURL(
            new Blob([sheet.xml], { type: 'application/vnd.recordare.musicxml+xml' }),
          )
        : null,
    [sheet],
  );
  useEffect(
    () => () => {
      if (musicXmlUrl) URL.revokeObjectURL(musicXmlUrl);
    },
    [musicXmlUrl],
  );

  const printScore = (): void => {
    if (!engraved || !source) return;
    // A hidden frame holding only the engraved pages; the browser's print
    // dialog offers "Save as PDF".
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(
      `<!doctype html><html><head><title>${source.name.replace(/[<>&"]/g, '')}</title>` +
        '<style>@page{margin:12mm}body{margin:0;background:#fff}svg{width:100%;height:auto;display:block;page-break-after:always}</style>' +
        `</head><body>${engraved.pages.join('')}</body></html>`,
    );
    doc.close();
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 1000);
    }, 200);
  };

  const fit = analysis?.fit ?? null;
  const busy =
    phase.kind === 'decoding' || phase.kind === 'analysing' || phase.kind === 'recording';
  const spanOk = source !== null && endSec - startSec >= 2 && endSec - startSec <= MAX_SPAN_SEC;

  return (
    <section
      aria-labelledby="qormada-browser-heading"
      className="mt-8 rounded-2xl border border-amber/40 bg-bg-secondary p-5 sm:p-6"
    >
      <h2 id="qormada-browser-heading" className="font-display text-2xl text-ink-primary">
        Turn a recording into sheet music
      </h2>
      <p className="mt-1 max-w-2xl font-body text-sm text-ink-secondary">
        Choose a recording or play into your microphone. The melody is written out with the scale
        and tuning measured from the recording itself. It all runs in this browser:{' '}
        <span className="text-ink-primary">your audio is never uploaded.</span>
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
          openFile(e.dataTransfer.files[0]);
        }}
        className={`mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-4 transition-colors ${
          dragging ? 'border-amber bg-bg-tertiary' : 'border-line-primary'
        }`}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-amber px-4 py-2 font-body text-sm font-semibold text-bg-primary transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Choose a recording…
        </button>
        {phase.kind === 'recording' ? (
          <button
            type="button"
            onClick={() => recorderRef.current?.stop()}
            className="rounded-lg border border-danger px-4 py-2 font-body text-sm font-semibold text-danger"
          >
            ■ Stop recording · {clock((now - phase.startedAt) / 1000)}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void startRecording()}
            className="rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary disabled:opacity-40"
          >
            ● Record with microphone
          </button>
        )}
        <span className="font-body text-sm text-ink-tertiary">or drop an audio file here</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            openFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <p className="mt-2 font-body text-xs text-ink-tertiary">
        Works best with one voice or one instrument (oud, voice, flute, violin). A full band gives a
        rough melody. Up to 10 minutes per transcription.
      </p>

      {phase.kind === 'decoding' ? (
        <p role="status" className="mt-4 font-body text-sm text-ink-secondary">
          Reading the audio…
        </p>
      ) : null}
      {phase.kind === 'error' ? (
        <p role="alert" className="mt-4 font-body text-sm text-danger">
          {phase.message}
        </p>
      ) : null}

      {source !== null ? (
        <div className="mt-5 rounded-xl border border-line-secondary bg-bg-primary/40 p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-display text-lg text-ink-primary">{source.name}</h3>
            <span className="font-body text-xs text-ink-tertiary">{clock(source.durationSec)}</span>
          </div>
          <audio ref={audioRef} src={source.url} controls className="mt-3 w-full" />
          <div className="mt-2 flex flex-wrap items-center gap-2 font-body text-xs text-ink-secondary">
            <span>Practice speed</span>
            {[0.5, 0.75, 1].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                className={`rounded-md border px-2 py-1 ${
                  speed === s ? 'border-amber text-amber' : 'border-line-primary'
                }`}
              >
                {Math.round(s * 100)}%
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="font-body text-xs text-ink-secondary">
              From (s)
              <input
                type="number"
                min={0}
                max={Math.floor(source.durationSec)}
                step={1}
                value={Math.round(startSec)}
                onChange={(e) => setStartSec(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 block w-24 rounded-lg border border-line-primary bg-bg-primary px-2 py-1.5 text-sm text-ink-primary"
              />
            </label>
            <label className="font-body text-xs text-ink-secondary">
              To (s)
              <input
                type="number"
                min={1}
                max={Math.ceil(source.durationSec)}
                step={1}
                value={Math.round(endSec)}
                onChange={(e) =>
                  setEndSec(Math.min(source.durationSec, Math.max(0, Number(e.target.value) || 0)))
                }
                className="mt-1 block w-24 rounded-lg border border-line-primary bg-bg-primary px-2 py-1.5 text-sm text-ink-primary"
              />
            </label>
            {phase.kind === 'analysing' ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary"
              >
                Cancel · {Math.round(phase.progress * 100)}%
              </button>
            ) : (
              <button
                type="button"
                disabled={!spanOk || busy}
                onClick={() => void analyse()}
                className="rounded-lg bg-amber px-4 py-2 font-body text-sm font-semibold text-bg-primary disabled:opacity-40"
              >
                {analysis ? 'Transcribe again' : 'Transcribe'}
              </button>
            )}
          </div>
          {!spanOk ? (
            <p className="mt-2 font-body text-xs text-danger">
              Choose a part between 2 seconds and 10 minutes long.
            </p>
          ) : null}
        </div>
      ) : null}

      {sheet !== null && analysis !== null ? (
        <div className="mt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Scale" value={sheet.scaleName ?? 'not clear'} />
            <Stat label="Tuning" value={tuningLabel(analysis.offsetCents)} />
            <Stat
              label="Tempo"
              value={`${Math.round(sheet.bpm)} BPM${bpm === null ? ' (estimated)' : ''}`}
            />
            <Stat label="Notes" value={`${sheet.notes} · ${sheet.offScale} off-scale`} />
          </div>
          {fit?.tonicAmbiguous ? (
            <p className="mt-2 font-body text-xs text-ink-tertiary">
              The tonic is ambiguous: another note of the same scale fits almost as well. The notes
              are the same; only the scale’s name changes.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-end gap-3 font-body text-xs text-ink-secondary">
            <label>
              Tempo (BPM)
              <input
                type="number"
                min={30}
                max={240}
                placeholder={sheet.estimatedBpm ? String(Math.round(sheet.estimatedBpm)) : 'auto'}
                value={bpmText}
                onChange={(e) => setBpmText(e.target.value)}
                className="mt-1 block w-24 rounded-lg border border-line-primary bg-bg-primary px-2 py-1.5 text-sm text-ink-primary"
              />
            </label>
            <label>
              Time
              <select
                value={beatsPerBar}
                onChange={(e) => setBeatsPerBar(Number(e.target.value))}
                className="mt-1 block rounded-lg border border-line-primary bg-bg-primary px-2 py-1.5 text-sm text-ink-primary"
              >
                <option value={4}>4/4</option>
                <option value={3}>3/4</option>
                <option value={2}>2/4</option>
              </select>
            </label>
            <label>
              Transpose
              <select
                value={transpose}
                onChange={(e) => setTranspose(Number(e.target.value))}
                className="mt-1 block rounded-lg border border-line-primary bg-bg-primary px-2 py-1.5 text-sm text-ink-primary"
              >
                {Array.from({ length: 25 }, (_, i) => i - 12).map((t) => (
                  <option key={t} value={t}>
                    {t > 0 ? `+${t}` : t === 0 ? 'none' : t} {t !== 0 ? 'semitones' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                checked={showCents}
                onChange={(e) => setShowCents(e.target.checked)}
              />
              Show tuning in cents
            </label>
            <label className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                checked={includeOffScale}
                onChange={(e) => setIncludeOffScale(e.target.checked)}
              />
              Keep off-scale notes
            </label>
            <label className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                checked={legato}
                onChange={(e) => setLegato(e.target.checked)}
              />
              Join short gaps (legato)
            </label>
          </div>
          <p className="mt-2 max-w-3xl font-body text-xs text-ink-tertiary">
            Numbers under notes: how far the note was sung or played from the written pitch, in
            cents (100 = one semitone). <span className="text-danger">Red notes</span> lie outside
            the measured scale; they are kept because ornaments are music, not errors. Automatic
            transcription: check it by ear.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {musicXmlUrl ? (
              <a
                href={musicXmlUrl}
                download={`${source?.name ?? 'qormada'}.musicxml`}
                className="rounded-lg border border-line-primary px-3 py-1.5 font-body text-xs text-ink-secondary hover:text-ink-primary"
              >
                Download MusicXML
              </a>
            ) : null}
            {engraved ? (
              <>
                <a
                  href={engraved.midiDataUrl}
                  download={`${source?.name ?? 'qormada'}.mid`}
                  className="rounded-lg border border-line-primary px-3 py-1.5 font-body text-xs text-ink-secondary hover:text-ink-primary"
                >
                  Download MIDI
                </a>
                <button
                  type="button"
                  onClick={printScore}
                  className="rounded-lg border border-line-primary px-3 py-1.5 font-body text-xs text-ink-secondary hover:text-ink-primary"
                >
                  Print / save as PDF
                </button>
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
                className="h-8 w-8 rounded-lg border border-line-primary font-body text-ink-secondary"
              >
                −
              </button>
              <span className="w-12 text-center font-body text-xs text-ink-secondary">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))}
                className="h-8 w-8 rounded-lg border border-line-primary font-body text-ink-secondary"
              >
                +
              </button>
            </div>
          </div>

          {engraveError !== null ? (
            <p role="alert" className="mt-3 font-body text-sm text-danger">
              {engraveError}
            </p>
          ) : null}
          {engraved !== null ? (
            <>
              {playerReady ? (
                <div className="mt-3">
                  <p className="mb-1 font-body text-xs text-ink-tertiary">
                    Listen to the sheet music
                  </p>
                  <midi-player
                    src={engraved.midiDataUrl}
                    sound-font={SOUND_FONT}
                    className="block w-full"
                  />
                </div>
              ) : null}
              <div className="mt-4 flex flex-col gap-4">
                {engraved.pages.map((svg, i) => (
                  <div
                    key={i}
                    aria-label={`Sheet music, page ${i + 1}`}
                    className="overflow-x-auto rounded-lg bg-bg-inverse p-3 ring-1 ring-line-primary sm:p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
                    // Verovio's SVG for MusicXML this page wrote from the local analysis.
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-line-secondary bg-bg-primary/40 px-3 py-2.5">
      <p className="font-body text-xs uppercase tracking-wider text-ink-tertiary">{label}</p>
      <p className="mt-1 font-display text-base text-amber">{value}</p>
    </div>
  );
}

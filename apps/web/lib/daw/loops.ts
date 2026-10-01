/**
 * Loops & audio content (Studio v2) — the Loop Browser's data layer and the
 * small adapters the import/export UI uses to reach engine features.
 *
 * Content rule (DATA_PROVENANCE.md, public-audio-rights.json): the studio
 * only ever references QaraamiGen model output (/demos/gallery/,
 * /demos/generated/), the synthesised sample fixtures, and audio the member
 * imports or records in their own browser. Source recordings — anything
 * under /audio/ — are never referenced, loaded or copied.
 */

import type { DawEngine } from './engine';
import {
  newAudioRegion,
  newAudioTrack,
  projectEndBeat,
  type DawAudioRegion,
  type DawProject,
  type DawTrack,
} from './types';

// ── gallery clips ────────────────────────────────────────────────────────────

/** One entry of lib/gallery-clips.json (`groups[].sections[].clips[]`). */
export interface GalleryClipRaw {
  id: string;
  file: string;
  title: string;
  model: string;
  adapter: string;
  checkpoint: string;
  prompt: string;
  durationSec: number;
  vocals: boolean;
  adapterId?: string;
  seed?: number | null;
  pcs?: number | null;
  voiced?: number | null;
  bandSnrDb?: number | null;
  autoPick?: boolean | null;
}

export interface GalleryJson {
  groups: {
    title: string;
    note?: string;
    sections: { title: string; clips: GalleryClipRaw[] }[];
  }[];
}

/** A flattened, browser-ready loop. */
export interface LoopClip {
  id: string;
  url: string;
  title: string;
  model: string;
  adapter: string;
  checkpoint: string;
  prompt: string;
  durationSec: number;
  vocals: boolean;
  group: string;
  section: string;
  pcs: number | null;
  voiced: number | null;
  bandSnrDb: number | null;
  autoPick: boolean;
}

/** Same-origin prefixes that hold releasable model output. */
const MODEL_OUTPUT_PREFIXES = ['/demos/gallery/', '/demos/generated/'] as const;

export function isModelOutputUrl(url: string): boolean {
  return MODEL_OUTPUT_PREFIXES.some((p) => url.startsWith(p)) && !url.includes('..');
}

/**
 * Whether an audio-region source may be loaded by the studio: model output,
 * browser-local user audio (idb: / blob:), or the synthesised sample fixtures.
 * Everything else — notably /audio/ source recordings and remote URLs — is refused.
 */
export function isAllowedAudioSource(source: string): boolean {
  if (source.startsWith('idb:')) return source.length > 4;
  if (source.startsWith('blob:')) return true;
  if (source === '/sample/audio.mp3') return true;
  return isModelOutputUrl(source);
}

export function flattenGallery(json: GalleryJson): LoopClip[] {
  const out: LoopClip[] = [];
  const seen = new Set<string>();
  for (const group of json.groups) {
    for (const section of group.sections) {
      for (const clip of section.clips) {
        if (seen.has(clip.id) || !isModelOutputUrl(clip.file)) continue;
        seen.add(clip.id);
        out.push({
          id: clip.id,
          url: clip.file,
          title: clip.title,
          model: clip.model,
          adapter: clip.adapter,
          checkpoint: clip.checkpoint,
          prompt: clip.prompt,
          durationSec: clip.durationSec,
          vocals: clip.vocals,
          group: group.title,
          section: section.title,
          pcs: clip.pcs ?? null,
          voiced: clip.voiced ?? null,
          bandSnrDb: clip.bandSnrDb ?? null,
          autoPick: clip.autoPick === true,
        });
      }
    }
  }
  return out;
}

let galleryPromise: Promise<LoopClip[]> | null = null;

/** Lazy-load the gallery list (≈350 kB JSON) only when the browser opens. */
export function loadGalleryClips(): Promise<LoopClip[]> {
  galleryPromise ??= import('@/lib/gallery-clips.json').then((m) =>
    flattenGallery(m.default as GalleryJson),
  );
  return galleryPromise;
}

export type LoopKindFilter = 'all' | 'vocals' | 'oud';
export type LoopSort = 'gallery' | 'pcs' | 'voiced' | 'title' | 'duration';

export interface LoopFilter {
  query: string;
  kind: LoopKindFilter;
  /** Exact model string, or 'all'. */
  model: string;
  autoPickOnly: boolean;
  sort: LoopSort;
}

export const DEFAULT_LOOP_FILTER: LoopFilter = {
  query: '',
  kind: 'all',
  model: 'all',
  autoPickOnly: false,
  sort: 'gallery',
};

export function filterLoops(clips: readonly LoopClip[], filter: LoopFilter): LoopClip[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = clips.filter((clip) => {
    if (filter.kind === 'vocals' && !clip.vocals) return false;
    if (filter.kind === 'oud' && clip.vocals) return false;
    if (filter.model !== 'all' && clip.model !== filter.model) return false;
    if (filter.autoPickOnly && !clip.autoPick) return false;
    if (terms.length === 0) return true;
    const hay = `${clip.title} ${clip.prompt} ${clip.id} ${clip.adapter}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const metric = (value: number | null): number => (value === null ? -Infinity : value);
  switch (filter.sort) {
    case 'pcs':
      return kept.sort((a, b) => metric(b.pcs) - metric(a.pcs));
    case 'voiced':
      return kept.sort((a, b) => metric(b.voiced) - metric(a.voiced));
    case 'title':
      return kept.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    case 'duration':
      return kept.sort((a, b) => a.durationSec - b.durationSec);
    case 'gallery':
      return kept;
  }
}

export function loopModels(clips: readonly LoopClip[]): string[] {
  return [...new Set(clips.map((c) => c.model))].sort();
}

/** Seconds → beats at the project tempo. */
export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}

/** A new audio track holding one region (not yet in the project). */
export function audioTrackFor(
  source: string,
  name: string,
  durationSec: number,
  project: Pick<DawProject, 'bpm'>,
  startBeat: number,
): { track: DawTrack; region: DawAudioRegion } {
  if (!isAllowedAudioSource(source)) {
    throw new Error('This audio source is not allowed in the studio.');
  }
  const track = newAudioTrack(name.slice(0, 80) || 'Audio');
  const lengthBeats = Math.max(0.25, secondsToBeats(durationSec, project.bpm));
  const region = newAudioRegion(source, name.slice(0, 120) || 'Audio', startBeat, lengthBeats);
  track.audioRegions = [region];
  return { track, region };
}

/** Push a gallery clip onto a draft as a new audio track. */
export function addLoopTrack(draft: DawProject, clip: LoopClip, startBeat: number): DawTrack {
  const { track } = audioTrackFor(clip.url, clip.title, clip.durationSec, draft, startBeat);
  draft.tracks.push(track);
  return track;
}

/** Drag-and-drop payload type for gallery clips. */
export const LOOP_DRAG_MIME = 'application/x-qaraami-loop';

// ── engine adapters (features another branch adds) ───────────────────────────

export interface RenderMixOptions {
  /** Restrict the render to these track ids (stems). Absent = the full mix. */
  tracks?: string[];
}

interface RenderMixCapable {
  renderMix: (project: DawProject, options?: RenderMixOptions) => Promise<AudioBuffer>;
}

function hasRenderMix(engine: object): engine is RenderMixCapable {
  return (
    'renderMix' in engine && typeof (engine as { renderMix: unknown }).renderMix === 'function'
  );
}

/** A copy of the project that plays only the given tracks (mute/solo cleared on them). */
export function projectWithOnly(project: DawProject, trackIds: readonly string[]): DawProject {
  const keep = new Set(trackIds);
  return {
    ...project,
    tracks: project.tracks
      .filter((t) => keep.has(t.id))
      .map((t) => ({ ...t, muted: false, solo: false })),
  };
}

/**
 * Render the mix — or only some tracks — to an AudioBuffer. Uses the engine's
 * `renderMix` (audio regions + fx) when present, else the Tier-1
 * `renderMixdown` (MIDI voices only).
 */
export async function renderProject(
  engine: DawEngine,
  project: DawProject,
  trackIds?: readonly string[],
): Promise<AudioBuffer> {
  if (hasRenderMix(engine)) {
    return engine.renderMix(project, trackIds ? { tracks: [...trackIds] } : {});
  }
  return engine.renderMixdown(trackIds ? projectWithOnly(project, trackIds) : project);
}

/** Whether the current engine can render audio regions (else stems/mix are MIDI-only). */
export function engineRendersAudio(engine: DawEngine): boolean {
  return hasRenderMix(engine);
}

// ── user audio storage ───────────────────────────────────────────────────────

/**
 * The engine branch owns lib/daw/audioStore.ts (IndexedDB). Until it is merged
 * here, the store is reached through this registry: register it once
 * (e.g. `registerAudioStore({ put: (blob, name) => audioStore.putAudio(blob, name) })`),
 * and imports persist as `idb:<id>`; without it, imports are session-only
 * object URLs.
 */
export interface AudioStoreAdapter {
  /** Persist the blob; resolves to the region source ('idb:<id>'). */
  put: (blob: Blob, name: string) => Promise<string>;
}

let audioStore: AudioStoreAdapter | null = null;

export function registerAudioStore(adapter: AudioStoreAdapter | null): void {
  audioStore = adapter;
}

export interface StoredAudio {
  source: string;
  /** False when the audio only lives for this browser session (object URL). */
  persistent: boolean;
}

export async function storeUserAudio(file: Blob, name: string): Promise<StoredAudio> {
  if (audioStore) {
    try {
      const source = await audioStore.put(file, name);
      if (source.startsWith('idb:')) return { source, persistent: true };
    } catch {
      // Quota or private mode — fall back to a session URL below.
    }
  }
  return { source: URL.createObjectURL(file), persistent: false };
}

export const IMPORTABLE_AUDIO = /\.(wav|wave|mp3|m4a|aac|ogg|oga|opus|flac)$/i;
export const IMPORTABLE_AUDIO_ACCEPT =
  '.wav,.mp3,.m4a,.ogg,.oga,.opus,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg';

/** Read a playable file's duration in seconds (browser only). */
export function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) resolve(d);
      else reject(new Error('could not read the audio duration'));
    };
    audio.onerror = () => reject(new Error('this browser cannot decode the file'));
    audio.src = url;
  });
}

/** Default drop position: the playhead, else the project's end. */
export function insertBeat(project: DawProject, playheadBeat: number): number {
  return Number.isFinite(playheadBeat) && playheadBeat >= 0
    ? playheadBeat
    : projectEndBeat(project);
}

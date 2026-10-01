/**
 * Arrangement + note edit operations (Studio v2) — pure functions over the
 * plain document. Every operation takes a project and returns a NEW project
 * (the input is never mutated), plus the selection the UI should show next.
 * Both region kinds are handled: MIDI regions (`track.regions`) and audio
 * regions (`track.audioRegions`); a region only ever lives on a track of its
 * own kind.
 *
 * Optional extras the shared contract (types.ts) does not name — a MIDI
 * region's `name`, a track's `color` — are stored as additive fields, which
 * docs/DAW-PROJECT-FORMAT.md allows (readers ignore unknown fields, writers
 * preserve them), and are read only through the helpers below.
 */

import {
  audioRegionsOf,
  cloneProject,
  newId,
  newRegion,
  trackKind,
  type DawAudioRegion,
  type DawMarker,
  type DawNote,
  type DawProject,
  type DawRegion,
  type DawTrack,
} from './types';

export interface RegionRef {
  trackId: string;
  regionId: string;
}

export type AnyRegion = DawRegion | DawAudioRegion;

export interface EditResult {
  project: DawProject;
  selection: RegionRef[];
}

const EPS = 1e-6;
/** Shortest region a trim may leave, in beats. */
export const MIN_REGION_BEATS = 0.25;
/** Shortest note an edit may leave, in beats. */
export const MIN_NOTE_BEATS = 1 / 32;

// ── snap grid ───────────────────────────────────────────────────────────────

export type SnapValue =
  'bar' | 'beat' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | '1/4T' | '1/8T' | '1/16T' | 'off';

export const SNAP_OPTIONS: ReadonlyArray<{ value: SnapValue; label: string }> = [
  { value: 'bar', label: 'Bar' },
  { value: 'beat', label: 'Beat' },
  { value: '1/2', label: '1/2 note' },
  { value: '1/4', label: '1/4 note' },
  { value: '1/8', label: '1/8 note' },
  { value: '1/16', label: '1/16 note' },
  { value: '1/32', label: '1/32 note' },
  { value: '1/4T', label: '1/4 triplet' },
  { value: '1/8T', label: '1/8 triplet' },
  { value: '1/16T', label: '1/16 triplet' },
  { value: 'off', label: 'Off' },
];

/**
 * Grid size in beats, or null when snapping is off. Note values are relative
 * to the time signature's beat unit: in 4/4 a 1/8 note is half a beat, in 6/8
 * (beat = eighth) a 1/16 note is half a beat. Triplets are 2/3 of the value.
 */
export function snapBeats(
  value: SnapValue,
  timeSignature: DawProject['timeSignature'],
): number | null {
  switch (value) {
    case 'off':
      return null;
    case 'bar':
      return timeSignature.beatsPerBar;
    case 'beat':
      return 1;
    default: {
      const triplet = value.endsWith('T');
      const denominator = Number(value.replace('T', '').split('/')[1] ?? '4');
      const beats = timeSignature.beatUnit / denominator;
      return triplet ? (beats * 2) / 3 : beats;
    }
  }
}

/** Round to the grid (null grid = unchanged). Cleans float dust. */
export function snapBeat(beat: number, grid: number | null): number {
  if (grid === null || grid <= 0) return beat;
  return Math.round(Math.round(beat / grid) * grid * 1e6) / 1e6;
}

/** Strength-weighted quantize of one time value (strength 0–1). */
export function quantizeValue(beat: number, grid: number, strength: number): number {
  const s = Math.min(1, Math.max(0, strength));
  const target = snapBeat(beat, grid);
  return Math.round((beat + (target - beat) * s) * 1e6) / 1e6;
}

// ── lookup + small helpers ──────────────────────────────────────────────────

export function regionSpan(region: AnyRegion): number {
  return region.lengthBeats * region.loopCount;
}

export function regionEnd(region: AnyRegion): number {
  return region.startBeat + regionSpan(region);
}

export function allRegions(track: DawTrack): AnyRegion[] {
  return [...track.regions, ...audioRegionsOf(track)];
}

export function findRegion(
  project: DawProject,
  ref: RegionRef,
): { track: DawTrack; trackIndex: number; region: AnyRegion } | null {
  const trackIndex = project.tracks.findIndex((t) => t.id === ref.trackId);
  const track = project.tracks[trackIndex];
  if (!track) return null;
  const region =
    track.regions.find((r) => r.id === ref.regionId) ??
    audioRegionsOf(track).find((r) => r.id === ref.regionId);
  return region ? { track, trackIndex, region } : null;
}

export function sameRef(a: RegionRef, b: RegionRef): boolean {
  return a.trackId === b.trackId && a.regionId === b.regionId;
}

export function hasRef(list: readonly RegionRef[], ref: RegionRef): boolean {
  return list.some((r) => sameRef(r, ref));
}

/** Shift-click: add when absent, remove when present. */
export function toggleRef(list: readonly RegionRef[], ref: RegionRef): RegionRef[] {
  return hasRef(list, ref) ? list.filter((r) => !sameRef(r, ref)) : [...list, ref];
}

/** Drop refs whose region no longer exists (after undo, delete, …). */
export function pruneSelection(project: DawProject, refs: readonly RegionRef[]): RegionRef[] {
  return refs.filter((ref) => findRegion(project, ref) !== null);
}

export function regionName(region: AnyRegion, fallback = 'Region'): string {
  if (region.kind === 'audio') return region.name;
  if ('name' in region && typeof region.name === 'string' && region.name !== '') {
    return region.name;
  }
  return fallback;
}

/** Default track colours — oud-wood amber first, then muted studio hues. */
export const TRACK_COLORS = [
  '#C89B5F',
  '#5F9BC8',
  '#8FBF6A',
  '#C8675F',
  '#A07CC8',
  '#5FC8B4',
  '#C8B45F',
  '#C85FA0',
] as const;

export function trackColor(track: DawTrack, index: number): string {
  if ('color' in track && typeof track.color === 'string' && track.color !== '') {
    return track.color;
  }
  return TRACK_COLORS[index % TRACK_COLORS.length] ?? TRACK_COLORS[0];
}

function removeRegionFrom(track: DawTrack, regionId: string): void {
  track.regions = track.regions.filter((r) => r.id !== regionId);
  if (track.audioRegions) track.audioRegions = track.audioRegions.filter((r) => r.id !== regionId);
}

function insertRegion(track: DawTrack, region: AnyRegion): void {
  if (region.kind === 'audio') track.audioRegions = [...audioRegionsOf(track), region];
  else track.regions.push(region);
}

function accepts(track: DawTrack, region: AnyRegion): boolean {
  return trackKind(track) === region.kind;
}

/** Deep copy with fresh ids (region and, for MIDI, its notes). */
export function copyRegionWithNewIds<R extends AnyRegion>(region: R): R {
  const copy = JSON.parse(JSON.stringify(region)) as R;
  if (copy.kind === 'audio') {
    copy.id = newId('arg');
  } else {
    copy.id = newId('rgn');
    copy.notes = copy.notes.map((n) => ({ ...n, id: newId('nt') }));
  }
  return copy;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// ── selection ───────────────────────────────────────────────────────────────

export function selectAllRegions(project: DawProject): RegionRef[] {
  return project.tracks.flatMap((track) =>
    allRegions(track).map((r) => ({ trackId: track.id, regionId: r.id })),
  );
}

/**
 * Regions intersecting a marquee: beats [startBeat, endBeat) across track
 * indices firstTrack…lastTrack inclusive (either order).
 */
export function marqueeRefs(
  project: DawProject,
  box: { startBeat: number; endBeat: number; firstTrack: number; lastTrack: number },
): RegionRef[] {
  const b0 = Math.min(box.startBeat, box.endBeat);
  const b1 = Math.max(box.startBeat, box.endBeat);
  const t0 = Math.min(box.firstTrack, box.lastTrack);
  const t1 = Math.max(box.firstTrack, box.lastTrack);
  const out: RegionRef[] = [];
  project.tracks.forEach((track, index) => {
    if (index < t0 || index > t1) return;
    for (const r of allRegions(track)) {
      if (r.startBeat < b1 && regionEnd(r) > b0) out.push({ trackId: track.id, regionId: r.id });
    }
  });
  return out;
}

// ── region operations ───────────────────────────────────────────────────────

/**
 * Move regions by `deltaBeats` (clamped so none starts before 0) and
 * optionally `deltaTracks` lanes (ignored for all when any region would land
 * off the track list or on a track of the other kind). With `copy`, the
 * originals stay and moved copies are created (⌥-drag).
 */
export function moveRegions(
  project: DawProject,
  refs: readonly RegionRef[],
  deltaBeats: number,
  deltaTracks = 0,
  options: { copy?: boolean } = {},
): EditResult {
  const next = cloneProject(project);
  const found = refs
    .map((ref) => findRegion(next, ref))
    .filter((f): f is NonNullable<typeof f> => f !== null);
  if (found.length === 0) return { project: next, selection: [] };

  const minStart = Math.min(...found.map((f) => f.region.startBeat));
  const delta = Math.max(deltaBeats, -minStart);
  const trackOk = found.every((f) => {
    const target = next.tracks[f.trackIndex + deltaTracks];
    return target !== undefined && accepts(target, f.region);
  });
  const dTracks = trackOk ? deltaTracks : 0;

  const selection: RegionRef[] = [];
  for (const f of found) {
    const target = next.tracks[f.trackIndex + dTracks] ?? f.track;
    const moved = options.copy === true ? copyRegionWithNewIds(f.region) : f.region;
    moved.startBeat = round6(f.region.startBeat + delta);
    if (options.copy !== true && target !== f.track) {
      removeRegionFrom(f.track, f.region.id);
      insertRegion(target, moved);
    } else if (options.copy === true) {
      insertRegion(target, moved);
    }
    selection.push({ trackId: target.id, regionId: moved.id });
  }
  return { project: next, selection };
}

/**
 * Trim an edge to `beat` (already snapped by the caller).
 * Right edge: sets the content length (one loop pass), non-destructive — MIDI
 * notes past the end are kept and play again if the region grows.
 * Left edge: moves the start and keeps the content in place — MIDI notes
 * shift (notes now before the start are dropped); audio advances `offsetSec`
 * and cannot reach before the file's beginning.
 */
export function trimRegion(
  project: DawProject,
  ref: RegionRef,
  edge: 'left' | 'right',
  beat: number,
  options: { secPerBeat: number; minBeats?: number },
): DawProject {
  const next = cloneProject(project);
  const found = findRegion(next, ref);
  if (!found) return next;
  const region = found.region;
  const minBeats = options.minBeats ?? MIN_REGION_BEATS;

  if (edge === 'right') {
    region.lengthBeats = round6(Math.max(minBeats, beat - region.startBeat));
    return next;
  }

  const end = region.startBeat + region.lengthBeats;
  let newStart = Math.max(0, Math.min(beat, end - minBeats));
  let delta = newStart - region.startBeat;
  if (region.kind === 'audio') {
    const offsetBeats = region.offsetSec / options.secPerBeat;
    if (delta < -offsetBeats) {
      delta = -offsetBeats;
      newStart = region.startBeat + delta;
    }
    region.offsetSec = Math.max(0, round6(region.offsetSec + delta * options.secPerBeat));
  } else {
    region.notes = region.notes
      .map((n) => ({ ...n, startBeat: round6(n.startBeat - delta) }))
      .filter((n) => n.startBeat >= -EPS)
      .map((n) => ({ ...n, startBeat: Math.max(0, n.startBeat) }));
  }
  region.startBeat = round6(newStart);
  region.lengthBeats = round6(end - newStart);
  return next;
}

/** Loop-drag: the region repeats until `endBeat` (rounded to whole passes, ≥1). */
export function loopRegionTo(project: DawProject, ref: RegionRef, endBeat: number): DawProject {
  const next = cloneProject(project);
  const found = findRegion(next, ref);
  if (!found) return next;
  const r = found.region;
  r.loopCount = Math.max(1, Math.round((endBeat - r.startBeat) / r.lengthBeats));
  return next;
}

export function changeLoopCount(
  project: DawProject,
  refs: readonly RegionRef[],
  delta: number,
): DawProject {
  const next = cloneProject(project);
  for (const ref of refs) {
    const found = findRegion(next, ref);
    if (found) found.region.loopCount = Math.max(1, found.region.loopCount + delta);
  }
  return next;
}

/** Expand a looped MIDI region into explicit notes (loopCount → 1). */
export function unrollMidi(region: DawRegion): DawRegion {
  const notes: DawNote[] = [];
  for (let pass = 0; pass < region.loopCount; pass++) {
    for (const n of region.notes) {
      if (n.startBeat < 0 || n.startBeat >= region.lengthBeats) continue;
      notes.push({
        ...n,
        id: pass === 0 ? n.id : newId('nt'),
        startBeat: round6(n.startBeat + pass * region.lengthBeats),
      });
    }
  }
  return { ...region, lengthBeats: region.lengthBeats * region.loopCount, loopCount: 1, notes };
}

function splitMidi(region: DawRegion, cut: number): [DawRegion, DawRegion] {
  const flat = unrollMidi(region);
  const left: DawRegion = {
    ...flat,
    lengthBeats: round6(cut),
    notes: flat.notes
      .filter((n) => n.startBeat < cut - EPS)
      .map((n) => ({ ...n, lengthBeats: round6(Math.min(n.lengthBeats, cut - n.startBeat)) })),
  };
  const right: DawRegion = {
    ...flat,
    id: newId('rgn'),
    startBeat: round6(region.startBeat + cut),
    lengthBeats: round6(flat.lengthBeats - cut),
    notes: flat.notes
      .filter((n) => n.startBeat >= cut - EPS)
      .map((n) => ({ ...n, id: newId('nt'), startBeat: round6(Math.max(0, n.startBeat - cut)) })),
  };
  return [left, right];
}

/**
 * Split an audio region at `cut` beats from its start. A looped region splits
 * into up to four pieces: the whole passes before the cut, the partial pass
 * either side of it, and the whole passes after it. Returns [left…, right…].
 */
function splitAudio(
  region: DawAudioRegion,
  cut: number,
  secPerBeat: number,
): { left: DawAudioRegion[]; right: DawAudioRegion[] } {
  const len = region.lengthBeats;
  const pass = Math.floor(cut / len + EPS);
  const within = round6(cut - pass * len);
  const left: DawAudioRegion[] = [];
  const right: DawAudioRegion[] = [];
  const passStart = round6(region.startBeat + pass * len);

  if (within <= EPS) {
    left.push({ ...region, loopCount: pass });
    right.push({
      ...region,
      id: newId('arg'),
      startBeat: passStart,
      loopCount: region.loopCount - pass,
    });
    return { left, right };
  }
  if (pass > 0) left.push({ ...region, loopCount: pass });
  left.push({
    ...region,
    id: pass > 0 ? newId('arg') : region.id,
    startBeat: passStart,
    lengthBeats: within,
    loopCount: 1,
    fadeOutSec: Math.min(region.fadeOutSec, 0.01),
  });
  right.push({
    ...region,
    id: newId('arg'),
    startBeat: round6(passStart + within),
    lengthBeats: round6(len - within),
    loopCount: 1,
    offsetSec: round6(region.offsetSec + within * secPerBeat),
    fadeInSec: Math.min(region.fadeInSec, 0.01),
  });
  const remaining = region.loopCount - pass - 1;
  if (remaining > 0) {
    right.push({
      ...region,
      id: newId('arg'),
      startBeat: round6(passStart + len),
      loopCount: remaining,
    });
  }
  return { left, right };
}

/**
 * Split every given region that the playhead `beat` falls strictly inside.
 * Selection becomes the right-hand pieces (untouched refs stay selected).
 */
export function splitRegionsAt(
  project: DawProject,
  refs: readonly RegionRef[],
  beat: number,
  secPerBeat: number,
): EditResult {
  const next = cloneProject(project);
  const selection: RegionRef[] = [];
  for (const ref of refs) {
    const found = findRegion(next, ref);
    if (!found) continue;
    const { track, region } = found;
    const cut = beat - region.startBeat;
    if (cut <= EPS || cut >= regionSpan(region) - EPS) {
      selection.push(ref);
      continue;
    }
    removeRegionFrom(track, region.id);
    if (region.kind === 'midi') {
      const [left, right] = splitMidi(region, cut);
      insertRegion(track, left);
      insertRegion(track, right);
      selection.push({ trackId: track.id, regionId: right.id });
    } else {
      const pieces = splitAudio(region, cut, secPerBeat);
      for (const piece of [...pieces.left, ...pieces.right]) insertRegion(track, piece);
      for (const piece of pieces.right) selection.push({ trackId: track.id, regionId: piece.id });
    }
  }
  return { project: next, selection };
}

/** Duplicate the selection as a block, placed right after its end (⌘D). */
export function duplicateRegions(project: DawProject, refs: readonly RegionRef[]): EditResult {
  const found = refs
    .map((ref) => findRegion(project, ref))
    .filter((f): f is NonNullable<typeof f> => f !== null);
  if (found.length === 0) return { project: cloneProject(project), selection: [] };
  const start = Math.min(...found.map((f) => f.region.startBeat));
  const end = Math.max(...found.map((f) => regionEnd(f.region)));
  return moveRegions(project, refs, end - start, 0, { copy: true });
}

export function deleteRegions(project: DawProject, refs: readonly RegionRef[]): EditResult {
  const next = cloneProject(project);
  for (const ref of refs) {
    const track = next.tracks.find((t) => t.id === ref.trackId);
    if (track) removeRegionFrom(track, ref.regionId);
  }
  return { project: next, selection: [] };
}

export interface ClipboardItem {
  trackId: string;
  trackIndex: number;
  /** Beats from the clipboard's earliest region start. */
  offsetBeats: number;
  region: AnyRegion;
}

export interface RegionClipboard {
  items: ClipboardItem[];
  spanBeats: number;
}

export function copyRegions(
  project: DawProject,
  refs: readonly RegionRef[],
): RegionClipboard | null {
  const found = refs
    .map((ref) => findRegion(project, ref))
    .filter((f): f is NonNullable<typeof f> => f !== null);
  if (found.length === 0) return null;
  const start = Math.min(...found.map((f) => f.region.startBeat));
  const end = Math.max(...found.map((f) => regionEnd(f.region)));
  return {
    spanBeats: end - start,
    items: found.map((f) => ({
      trackId: f.track.id,
      trackIndex: f.trackIndex,
      offsetBeats: f.region.startBeat - start,
      region: JSON.parse(JSON.stringify(f.region)) as AnyRegion,
    })),
  };
}

export function cutRegions(
  project: DawProject,
  refs: readonly RegionRef[],
): { clipboard: RegionClipboard | null } & EditResult {
  const clipboard = copyRegions(project, refs);
  return { clipboard, ...deleteRegions(project, refs) };
}

/**
 * Paste at `atBeat`. With a target track the clipboard's top lane lands on
 * it and the other lanes keep their relative spacing; without one each item
 * returns to its original track. Items whose lane is missing or of the other
 * kind fall back to the first track that accepts them (or are skipped).
 */
export function pasteRegions(
  project: DawProject,
  clipboard: RegionClipboard,
  atBeat: number,
  targetTrackId: string | null = null,
): EditResult {
  const next = cloneProject(project);
  const selection: RegionRef[] = [];
  const topIndex = Math.min(...clipboard.items.map((i) => i.trackIndex));
  const targetIndex =
    targetTrackId === null ? -1 : next.tracks.findIndex((t) => t.id === targetTrackId);
  for (const item of clipboard.items) {
    const region = copyRegionWithNewIds(item.region);
    region.startBeat = round6(Math.max(0, atBeat + item.offsetBeats));
    const candidates: (DawTrack | undefined)[] = [
      targetIndex >= 0 ? next.tracks[targetIndex + (item.trackIndex - topIndex)] : undefined,
      next.tracks.find((t) => t.id === item.trackId),
      next.tracks.find((t) => accepts(t, region)),
    ];
    const track = candidates.find((t): t is DawTrack => t !== undefined && accepts(t, region));
    if (!track) continue;
    insertRegion(track, region);
    selection.push({ trackId: track.id, regionId: region.id });
  }
  return { project: next, selection };
}

/**
 * Join selected MIDI regions per track into one region spanning them all
 * (loops unrolled). Tracks with fewer than two selected MIDI regions, and
 * audio regions, are left alone.
 */
export function joinRegions(project: DawProject, refs: readonly RegionRef[]): EditResult {
  const next = cloneProject(project);
  const selection: RegionRef[] = [];
  const byTrack = new Map<string, DawRegion[]>();
  for (const ref of refs) {
    const found = findRegion(next, ref);
    if (!found || found.region.kind !== 'midi') continue;
    const list = byTrack.get(found.track.id) ?? [];
    list.push(found.region);
    byTrack.set(found.track.id, list);
  }
  for (const [trackId, regions] of byTrack) {
    const track = next.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    if (regions.length < 2) {
      for (const r of regions) selection.push({ trackId, regionId: r.id });
      continue;
    }
    const sorted = [...regions].sort((a, b) => a.startBeat - b.startBeat);
    const start = sorted[0]?.startBeat ?? 0;
    const end = Math.max(...sorted.map(regionEnd));
    const joined = newRegion(start, round6(end - start));
    const firstName = sorted[0] ? regionName(sorted[0], '') : '';
    if (firstName !== '') Object.assign(joined, { name: firstName });
    for (const r of sorted) {
      const flat = unrollMidi(r);
      for (const n of flat.notes) {
        joined.notes.push({ ...n, startBeat: round6(n.startBeat + r.startBeat - start) });
      }
      removeRegionFrom(track, r.id);
    }
    joined.notes.sort((a, b) => a.startBeat - b.startBeat);
    track.regions.push(joined);
    selection.push({ trackId, regionId: joined.id });
  }
  return { project: next, selection };
}

export function renameRegion(project: DawProject, ref: RegionRef, name: string): DawProject {
  const next = cloneProject(project);
  const found = findRegion(next, ref);
  if (found) Object.assign(found.region, { name: name.trim().slice(0, 80) });
  return next;
}

/** Quantize every note of the given MIDI regions. */
export function quantizeRegions(
  project: DawProject,
  refs: readonly RegionRef[],
  grid: number,
  strength: number,
): DawProject {
  let next = project;
  for (const ref of refs) {
    const found = findRegion(next, ref);
    if (found?.region.kind === 'midi') next = quantizeNotes(next, ref, null, grid, strength);
  }
  return next === project ? cloneProject(project) : next;
}

// ── note operations (one MIDI region) ───────────────────────────────────────

function midiRegionOf(project: DawProject, ref: RegionRef): DawRegion | null {
  const found = findRegion(project, ref);
  return found?.region.kind === 'midi' ? found.region : null;
}

function pick(region: DawRegion, ids: readonly string[] | null): DawNote[] {
  if (ids === null) return region.notes;
  const set = new Set(ids);
  return region.notes.filter((n) => set.has(n.id));
}

/**
 * Quantize note starts to `grid` beats at `strength` (0–1). `ids` null = all
 * notes. A note never quantizes onto/after the region end (it would fall
 * silent) — it lands on the last grid line inside instead.
 */
export function quantizeNotes(
  project: DawProject,
  ref: RegionRef,
  ids: readonly string[] | null,
  grid: number,
  strength: number,
): DawProject {
  const next = cloneProject(project);
  const region = midiRegionOf(next, ref);
  if (!region || grid <= 0) return next;
  for (const note of pick(region, ids)) {
    let q = quantizeValue(note.startBeat, grid, strength);
    if (q >= region.lengthBeats - EPS) q = Math.floor((region.lengthBeats - EPS) / grid) * grid;
    note.startBeat = Math.max(0, round6(q));
  }
  return next;
}

export function addNote(
  project: DawProject,
  ref: RegionRef,
  note: Omit<DawNote, 'id'>,
): { project: DawProject; noteId: string | null } {
  const next = cloneProject(project);
  const region = midiRegionOf(next, ref);
  if (!region) return { project: next, noteId: null };
  const id = newId('nt');
  region.notes.push({ ...note, id });
  return { project: next, noteId: id };
}

/** Move notes in time and pitch; time clamped inside the region, pitch 0–127. */
export function moveNotes(
  project: DawProject,
  ref: RegionRef,
  ids: readonly string[],
  deltaBeats: number,
  deltaMidi: number,
  mapPitch: (midi: number) => number = (m) => m,
): DawProject {
  const next = cloneProject(project);
  const region = midiRegionOf(next, ref);
  if (!region) return next;
  const notes = pick(region, ids);
  if (notes.length === 0) return next;
  const minStart = Math.min(...notes.map((n) => n.startBeat));
  const maxStart = Math.max(...notes.map((n) => n.startBeat));
  const lo = Math.min(...notes.map((n) => n.midi));
  const hi = Math.max(...notes.map((n) => n.midi));
  const dBeats = Math.min(Math.max(deltaBeats, -minStart), region.lengthBeats - EPS - maxStart);
  const dMidi = Math.min(Math.max(deltaMidi, -lo), 127 - hi);
  for (const n of notes) {
    n.startBeat = round6(Math.max(0, n.startBeat + dBeats));
    n.midi = Math.min(127, Math.max(0, mapPitch(n.midi + dMidi)));
  }
  return next;
}

/** Change note lengths by `deltaBeats` (each stays ≥ minBeats). */
export function resizeNotes(
  project: DawProject,
  ref: RegionRef,
  ids: readonly string[],
  deltaBeats: number,
  minBeats = MIN_NOTE_BEATS,
): DawProject {
  const next = cloneProject(project);
  const region = midiRegionOf(next, ref);
  if (!region) return next;
  for (const n of pick(region, ids))
    n.lengthBeats = round6(Math.max(minBeats, n.lengthBeats + deltaBeats));
  return next;
}

export function deleteNotes(
  project: DawProject,
  ref: RegionRef,
  ids: readonly string[],
): DawProject {
  const next = cloneProject(project);
  const region = midiRegionOf(next, ref);
  if (!region) return next;
  const set = new Set(ids);
  region.notes = region.notes.filter((n) => !set.has(n.id));
  return next;
}

export function setNotesVelocity(
  project: DawProject,
  ref: RegionRef,
  ids: readonly string[],
  velocity: number,
): DawProject {
  const next = cloneProject(project);
  const region = midiRegionOf(next, ref);
  if (!region) return next;
  const v = Math.min(1, Math.max(0.01, velocity));
  for (const n of pick(region, ids)) n.velocity = Math.round(v * 1000) / 1000;
  return next;
}

/** Note ids inside a box: region-relative beats [b0,b1) × pitches [lo,hi]. */
export function notesInBox(
  region: DawRegion,
  box: { startBeat: number; endBeat: number; lowMidi: number; highMidi: number },
): string[] {
  const b0 = Math.min(box.startBeat, box.endBeat);
  const b1 = Math.max(box.startBeat, box.endBeat);
  const lo = Math.min(box.lowMidi, box.highMidi);
  const hi = Math.max(box.lowMidi, box.highMidi);
  return region.notes
    .filter(
      (n) => n.midi >= lo && n.midi <= hi && n.startBeat < b1 && n.startBeat + n.lengthBeats > b0,
    )
    .map((n) => n.id);
}

export interface NoteClipboard {
  /** Starts relative to the earliest copied note. */
  notes: Omit<DawNote, 'id'>[];
}

export function copyNotes(region: DawRegion, ids: readonly string[]): NoteClipboard | null {
  const notes = pick(region, ids);
  if (notes.length === 0) return null;
  const start = Math.min(...notes.map((n) => n.startBeat));
  return {
    notes: notes.map((n) => ({
      startBeat: round6(n.startBeat - start),
      lengthBeats: n.lengthBeats,
      midi: n.midi,
      velocity: n.velocity,
    })),
  };
}

/** Paste notes at region-relative `atBeat`; notes past the region end are dropped. */
export function pasteNotes(
  project: DawProject,
  ref: RegionRef,
  clipboard: NoteClipboard,
  atBeat: number,
): { project: DawProject; noteIds: string[] } {
  const next = cloneProject(project);
  const region = midiRegionOf(next, ref);
  if (!region) return { project: next, noteIds: [] };
  const ids: string[] = [];
  for (const n of clipboard.notes) {
    const startBeat = round6(Math.max(0, atBeat) + n.startBeat);
    if (startBeat >= region.lengthBeats) continue;
    const id = newId('nt');
    region.notes.push({ ...n, id, startBeat });
    ids.push(id);
  }
  return { project: next, noteIds: ids };
}

// ── recording ───────────────────────────────────────────────────────────────

export interface RecordedNote {
  midi: number;
  velocity: number;
  /** Absolute timeline beats. */
  startBeat: number;
  endBeat: number;
}

/**
 * Turn a take into a MIDI region: bar-aligned start, length rounded up to
 * whole bars, notes relative to the region. Null for an empty take.
 */
export function buildRecordedRegion(
  notes: readonly RecordedNote[],
  beatsPerBar: number,
): DawRegion | null {
  if (notes.length === 0) return null;
  const first = Math.min(...notes.map((n) => n.startBeat));
  const last = Math.max(...notes.map((n) => Math.max(n.endBeat, n.startBeat + MIN_NOTE_BEATS)));
  const start = Math.floor(first / beatsPerBar + EPS) * beatsPerBar;
  const end = Math.max(start + beatsPerBar, Math.ceil(last / beatsPerBar - EPS) * beatsPerBar);
  const region = newRegion(start, end - start);
  region.notes = notes
    .map((n) => ({
      id: newId('nt'),
      startBeat: round6(n.startBeat - start),
      lengthBeats: round6(Math.max(MIN_NOTE_BEATS, n.endBeat - n.startBeat)),
      midi: Math.min(127, Math.max(0, n.midi)),
      velocity: Math.min(1, Math.max(0.01, n.velocity)),
    }))
    .sort((a, b) => a.startBeat - b.startBeat);
  return region;
}

/** Runtime guard for an audio region handed back by the engine. */
export function isAudioRegion(value: unknown): value is DawAudioRegion {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['kind'] === 'audio' &&
    typeof v['id'] === 'string' &&
    typeof v['source'] === 'string' &&
    typeof v['startBeat'] === 'number' &&
    typeof v['lengthBeats'] === 'number'
  );
}

export function insertAudioRegion(
  project: DawProject,
  trackId: string,
  region: DawAudioRegion,
): EditResult {
  const next = cloneProject(project);
  const track = next.tracks.find((t) => t.id === trackId);
  if (!track || trackKind(track) !== 'audio') return { project: next, selection: [] };
  insertRegion(track, { ...region, loopCount: Math.max(1, region.loopCount || 1) });
  return { project: next, selection: [{ trackId, regionId: region.id }] };
}

// ── markers ─────────────────────────────────────────────────────────────────

export function markersOf(project: DawProject): DawMarker[] {
  return [...(project.markers ?? [])].sort((a, b) => a.beat - b.beat);
}

export function addMarker(
  project: DawProject,
  beat: number,
  name?: string,
): { project: DawProject; markerId: string } {
  const next = cloneProject(project);
  const markers = next.markers ?? [];
  const id = newId('mk');
  markers.push({
    id,
    beat: Math.max(0, round6(beat)),
    name: name ?? `Marker ${markers.length + 1}`,
  });
  next.markers = markers.sort((a, b) => a.beat - b.beat);
  return { project: next, markerId: id };
}

export function renameMarker(project: DawProject, id: string, name: string): DawProject {
  const next = cloneProject(project);
  const marker = next.markers?.find((m) => m.id === id);
  if (marker) marker.name = name.trim().slice(0, 60) || marker.name;
  return next;
}

export function moveMarker(project: DawProject, id: string, beat: number): DawProject {
  const next = cloneProject(project);
  const marker = next.markers?.find((m) => m.id === id);
  if (marker) marker.beat = Math.max(0, round6(beat));
  if (next.markers) next.markers.sort((a, b) => a.beat - b.beat);
  return next;
}

export function deleteMarker(project: DawProject, id: string): DawProject {
  const next = cloneProject(project);
  if (next.markers) next.markers = next.markers.filter((m) => m.id !== id);
  return next;
}

/** Beat of the nearest marker strictly before/after `beat`, or null. */
export function adjacentMarkerBeat(
  project: DawProject,
  beat: number,
  direction: -1 | 1,
): number | null {
  const markers = markersOf(project);
  if (direction > 0) return markers.find((m) => m.beat > beat + 1e-3)?.beat ?? null;
  const before = markers.filter((m) => m.beat < beat - 1e-3);
  return before[before.length - 1]?.beat ?? null;
}

// ── tracks ──────────────────────────────────────────────────────────────────

export function moveTrack(project: DawProject, from: number, to: number): DawProject {
  const next = cloneProject(project);
  const [track] = next.tracks.splice(from, 1);
  if (!track) return next;
  const index = Math.max(0, Math.min(next.tracks.length, to));
  next.tracks.splice(index, 0, track);
  return next;
}

export function deleteTrack(project: DawProject, trackId: string): DawProject {
  const next = cloneProject(project);
  next.tracks = next.tracks.filter((t) => t.id !== trackId);
  return next;
}

export function renameTrack(project: DawProject, trackId: string, name: string): DawProject {
  const next = cloneProject(project);
  const track = next.tracks.find((t) => t.id === trackId);
  if (track) track.name = name.trim().slice(0, 40) || track.name;
  return next;
}

export function setTrackColor(project: DawProject, trackId: string, color: string): DawProject {
  const next = cloneProject(project);
  const track = next.tracks.find((t) => t.id === trackId);
  if (track) Object.assign(track, { color });
  return next;
}

/**
 * Project JSON backup (Studio v2) — export the plain document as a file and
 * read one back. Import validates the structure, gives the copy a fresh id
 * (so it never overwrites the project it came from) and drops any audio
 * region whose source the studio may not load (lib/daw/loops.ts
 * isAllowedAudioSource — e.g. /audio/ source recordings or remote URLs).
 * Session-only `blob:` sources cannot survive a file round trip and are
 * dropped too.
 */

import { isAllowedAudioSource } from './loops';
import {
  BPM_MAX,
  BPM_MIN,
  DAW_FORMAT_VERSION,
  newId,
  type DawProject,
  type InstrumentId,
} from './types';

export const PROJECT_FILE_EXTENSION = '.qaraami.json';

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

const INSTRUMENTS: readonly InstrumentId[] = ['oud', 'durbaan', 'bass', 'keys'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function projectToJson(project: DawProject): string {
  return JSON.stringify(project, null, 2);
}

export function projectFileName(project: Pick<DawProject, 'name'>, extension: string): string {
  const base = project.name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'project';
  return `${base}${extension}`;
}

export interface ParsedProjectFile {
  project: DawProject;
  /** Audio regions removed because their source cannot be loaded here. */
  droppedAudioRegions: number;
}

export function parseProjectJson(text: string): ParsedProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('the file is not valid JSON');
  }
  if (!isRecord(raw) || raw['formatVersion'] !== DAW_FORMAT_VERSION) {
    throw new ProjectFileError('not a QaraamiGen Studio project (formatVersion 1)');
  }
  if (!Array.isArray(raw['tracks']) || typeof raw['bpm'] !== 'number') {
    throw new ProjectFileError('the project has no tracks or tempo');
  }
  for (const track of raw['tracks']) {
    if (
      !isRecord(track) ||
      typeof track['id'] !== 'string' ||
      !Array.isArray(track['regions']) ||
      !INSTRUMENTS.includes(track['instrument'] as InstrumentId)
    ) {
      throw new ProjectFileError('the project contains a malformed track');
    }
  }

  const project = JSON.parse(text) as DawProject;
  let droppedAudioRegions = 0;
  for (const track of project.tracks) {
    if (track.audioRegions) {
      const kept = track.audioRegions.filter(
        (r) =>
          typeof r.source === 'string' &&
          isAllowedAudioSource(r.source) &&
          !r.source.startsWith('blob:'),
      );
      droppedAudioRegions += track.audioRegions.length - kept.length;
      track.audioRegions = kept;
    }
  }
  project.id = newId('proj');
  project.bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, project.bpm));
  project.updatedAt = new Date().toISOString();
  return { project, droppedAudioRegions };
}

/** Replace a draft's contents with an imported project (keeps the update/save path). */
export function replaceProject(draft: DawProject, incoming: DawProject): void {
  if (incoming.markers === undefined) delete draft.markers;
  Object.assign(draft, incoming);
}

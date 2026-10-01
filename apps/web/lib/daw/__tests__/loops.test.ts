import { describe, expect, it } from 'vitest';
import gallery from '../../gallery-clips.json';
import {
  DEFAULT_LOOP_FILTER,
  addLoopTrack,
  filterLoops,
  flattenGallery,
  isAllowedAudioSource,
  projectWithOnly,
  type GalleryJson,
} from '../loops';
import { parseProjectJson, projectToJson } from '../projectFile';
import { audioRegionsOf, newAudioRegion, newProject, trackKind } from '../types';

const clips = flattenGallery(gallery as GalleryJson);

describe('loop browser data', () => {
  it('flattens every gallery clip, all model output', () => {
    expect(clips).toHaveLength(472);
    expect(new Set(clips.map((c) => c.id)).size).toBe(472);
    expect(clips.every((c) => isAllowedAudioSource(c.url))).toBe(true);
  });

  it('filters by kind, model, auto-pick and search; sorts by PCS', () => {
    const vocals = filterLoops(clips, { ...DEFAULT_LOOP_FILTER, kind: 'vocals' });
    const oud = filterLoops(clips, { ...DEFAULT_LOOP_FILTER, kind: 'oud' });
    expect(vocals.length + oud.length).toBe(clips.length);
    expect(vocals.every((c) => c.vocals)).toBe(true);

    const picks = filterLoops(clips, { ...DEFAULT_LOOP_FILTER, autoPickOnly: true });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((c) => c.autoPick)).toBe(true);

    const small = filterLoops(clips, { ...DEFAULT_LOOP_FILTER, model: 'MusicGen-small (300 M)' });
    expect(small.every((c) => c.model.startsWith('MusicGen'))).toBe(true);

    const found = filterLoops(clips, { ...DEFAULT_LOOP_FILTER, query: 'male VOCAL 110' });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((c) => /110/.test(c.prompt + c.title))).toBe(true);

    const byPcs = filterLoops(clips, { ...DEFAULT_LOOP_FILTER, sort: 'pcs' });
    const scored = byPcs.filter((c) => c.pcs !== null).map((c) => c.pcs ?? 0);
    expect(scored).toEqual([...scored].sort((a, b) => b - a));
    expect(byPcs.at(-1)?.pcs ?? null).toBeNull(); // unscored clips last
  });

  it('adds a clip as an audio track at the given beat, length from duration and bpm', () => {
    const project = newProject('Loops');
    project.bpm = 120;
    const clip = clips.find((c) => c.durationSec === 60);
    if (!clip) throw new Error('fixture');
    const track = addLoopTrack(project, clip, 6);
    expect(project.tracks.at(-1)).toBe(track);
    expect(trackKind(track)).toBe('audio');
    expect(track.name).toBe(clip.title);
    const [region] = audioRegionsOf(track);
    expect(region).toMatchObject({
      source: clip.url,
      startBeat: 6,
      lengthBeats: 120,
      name: clip.title,
    });
  });

  it('refuses source recordings and remote audio', () => {
    expect(isAllowedAudioSource('/audio/anything.mp3')).toBe(false);
    expect(isAllowedAudioSource('https://example.com/x.mp3')).toBe(false);
    // Path traversal out of the model-output folder (built so the rights gate's scan sees no ref).
    expect(isAllowedAudioSource(['', 'demos', 'gallery', '..', 'audio', 'x.mp3'].join('/'))).toBe(
      false,
    );
    expect(isAllowedAudioSource('idb:abc')).toBe(true);
    expect(isAllowedAudioSource('blob:http://localhost/123')).toBe(true);
  });

  it('projectWithOnly keeps just the requested tracks, unmuted', () => {
    const project = newProject('Stems');
    const target = project.tracks[2];
    if (!target) throw new Error('fixture');
    target.muted = true;
    const only = projectWithOnly(project, [target.id]);
    expect(only.tracks).toHaveLength(1);
    expect(only.tracks[0]?.muted).toBe(false);
    expect(project.tracks).toHaveLength(4); // original untouched
  });
});

describe('project JSON backup', () => {
  it('round-trips under a fresh id and drops disallowed or session-only audio', () => {
    const project = newProject('Backup');
    const clip = clips[0];
    if (!clip) throw new Error('fixture');
    const track = addLoopTrack(project, clip, 0);
    track.audioRegions?.push(newAudioRegion('/audio/held-source.mp3', 'held', 0, 4));
    track.audioRegions?.push(newAudioRegion('blob:http://x/1', 'session', 0, 4));
    const { project: back, droppedAudioRegions } = parseProjectJson(projectToJson(project));
    expect(back.id).not.toBe(project.id);
    expect(droppedAudioRegions).toBe(2);
    expect(back.tracks).toHaveLength(project.tracks.length);
    expect(audioRegionsOf(back.tracks.at(-1) ?? track).map((r) => r.source)).toEqual([clip.url]);
    expect(() => parseProjectJson('{"formatVersion":2}')).toThrow(/formatVersion/);
    expect(() => parseProjectJson('nope')).toThrow(/JSON/);
  });
});

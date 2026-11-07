import { describe, expect, it } from 'vitest';
import {
  armOnly,
  dbToMeterPos,
  elapsedLabel,
  recordBlockedReason,
  recordableTakes,
} from '../recordFlow';
import { newAudioRegion, newAudioTrack, newProject, newTrack, type DawProject } from '../types';

function fixture(): DawProject {
  const project = newProject('t');
  project.tracks = [newTrack('Oud', 'oud'), newAudioTrack('Vox'), newAudioTrack('Guitar')];
  return project;
}

function track(project: DawProject, name: string) {
  const found = project.tracks.find((t) => t.name === name);
  if (!found) throw new Error(`no track ${name}`);
  return found;
}

describe('armOnly', () => {
  it('arms the given track and disarms every other one', () => {
    const project = fixture();
    track(project, 'Oud').armed = true;
    track(project, 'Guitar').armed = true;

    armOnly(project, track(project, 'Vox').id);

    expect(project.tracks.map((t) => [t.name, t.armed])).toEqual([
      ['Oud', false],
      ['Vox', true],
      ['Guitar', false],
    ]);
  });

  it('disarms everything when the id is unknown', () => {
    const project = fixture();
    track(project, 'Vox').armed = true;
    armOnly(project, 'nope');
    expect(project.tracks.every((t) => !t.armed)).toBe(true);
  });
});

describe('recordableTakes', () => {
  it('lists idb-sourced regions on audio tracks, newest first', () => {
    const project = fixture();
    const vox = track(project, 'Vox');
    const guitar = track(project, 'Guitar');
    vox.audioRegions = [
      newAudioRegion('idb:a', 'Take 1', 0, 8),
      newAudioRegion('idb:b', 'Take 3', 16, 4),
      newAudioRegion('/demos/gallery/v4pool_000_11.mp3', 'Gallery loop', 32, 8),
    ];
    guitar.audioRegions = [newAudioRegion('idb:c', 'Take 2', 16, 4)];
    // Audio regions on a MIDI track are not takes.
    track(project, 'Oud').audioRegions = [newAudioRegion('idb:d', 'Stray', 64, 4)];

    const takes = recordableTakes(project);

    expect(takes.map((t) => t.region.name)).toEqual(['Take 3', 'Take 2', 'Take 1']);
    expect(takes.map((t) => t.trackName)).toEqual(['Vox', 'Guitar', 'Vox']);
    expect(takes[0]?.trackId).toBe(vox.id);
    expect(takes[1]?.trackId).toBe(guitar.id);
  });

  it('is empty without idb sources and does not mutate the project', () => {
    const project = fixture();
    track(project, 'Vox').audioRegions = [newAudioRegion('/demos/x.mp3', 'Loop', 0, 4)];
    const before = JSON.stringify(project);
    expect(recordableTakes(project)).toEqual([]);
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe('elapsedLabel', () => {
  it('reads completed bars and beats at 4/4', () => {
    expect(elapsedLabel(11, 0, 4)).toBe('2 bars 3 beats');
    expect(elapsedLabel(27, 16, 4)).toBe('2 bars 3 beats');
    expect(elapsedLabel(5, 0, 4)).toBe('1 bar 1 beat');
    expect(elapsedLabel(4.9, 0, 4)).toBe('1 bar 0 beats');
  });

  it('starts at "0 bars 1 beat" and is never negative', () => {
    expect(elapsedLabel(0, 0, 4)).toBe('0 bars 1 beat');
    expect(elapsedLabel(0.5, 0, 4)).toBe('0 bars 1 beat');
    expect(elapsedLabel(2, 8, 4)).toBe('0 bars 1 beat');
  });

  it('follows the time signature', () => {
    expect(elapsedLabel(7, 0, 3)).toBe('2 bars 1 beat');
    expect(elapsedLabel(12, 0, 6)).toBe('2 bars 0 beats');
  });
});

describe('dbToMeterPos', () => {
  it('maps the −60…+6 dB scale to 0…1', () => {
    expect(dbToMeterPos(-60)).toBe(0);
    expect(dbToMeterPos(6)).toBe(1);
    expect(dbToMeterPos(-27)).toBeCloseTo(0.5, 6);
    expect(dbToMeterPos(0)).toBeCloseTo(60 / 66, 6);
  });

  it('clamps outside the scale and treats −∞ and NaN as silence', () => {
    expect(dbToMeterPos(-96)).toBe(0);
    expect(dbToMeterPos(12)).toBe(1);
    expect(dbToMeterPos(-Infinity)).toBe(0);
    expect(dbToMeterPos(Number.NaN)).toBe(0);
    expect(dbToMeterPos(Infinity)).toBe(1);
  });

  it('honours a custom range', () => {
    expect(dbToMeterPos(-10, -20, 0)).toBeCloseTo(0.5, 6);
    expect(dbToMeterPos(0, 0, 0)).toBe(0);
  });
});

describe('recordBlockedReason', () => {
  it('is null when an audio or a MIDI track is armed', () => {
    const audio = fixture();
    track(audio, 'Vox').armed = true;
    expect(recordBlockedReason(audio, null)).toBeNull();

    const midi = fixture();
    track(midi, 'Oud').armed = true;
    expect(recordBlockedReason(midi, null)).toBeNull();
  });

  it('asks for an armed track when nothing is armed', () => {
    const project = fixture();
    expect(recordBlockedReason(project, null)).toBe('Arm a track to record into it');
    expect(recordBlockedReason(project, track(project, 'Vox').id)).toBe(
      'Arm a track to record into it',
    );
  });

  it('is null when the selected track is an instrument track (armed on Record)', () => {
    const project = fixture();
    expect(recordBlockedReason(project, track(project, 'Oud').id)).toBeNull();
  });
});

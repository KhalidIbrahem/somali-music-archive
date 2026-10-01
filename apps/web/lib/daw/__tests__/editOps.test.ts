import { describe, expect, it } from 'vitest';
import {
  addMarker,
  adjacentMarkerBeat,
  buildRecordedRegion,
  changeLoopCount,
  copyNotes,
  copyRegions,
  cutRegions,
  deleteMarker,
  deleteNotes,
  deleteRegions,
  deleteTrack,
  duplicateRegions,
  findRegion,
  insertAudioRegion,
  isAudioRegion,
  joinRegions,
  loopRegionTo,
  marqueeRefs,
  moveNotes,
  moveRegions,
  moveTrack,
  notesInBox,
  pasteNotes,
  pasteRegions,
  pruneSelection,
  quantizeNotes,
  quantizeRegions,
  quantizeValue,
  regionName,
  renameMarker,
  renameRegion,
  resizeNotes,
  selectAllRegions,
  setNotesVelocity,
  setTrackColor,
  snapBeat,
  snapBeats,
  splitRegionsAt,
  toggleRef,
  trackColor,
  trimRegion,
  unrollMidi,
  type AnyRegion,
  type RegionRef,
} from '../editOps';
import {
  newAudioRegion,
  newAudioTrack,
  newProject,
  newRegion,
  newTrack,
  type DawAudioRegion,
  type DawProject,
  type DawRegion,
} from '../types';

const TS44 = { beatsPerBar: 4, beatUnit: 4 };
/** 120 BPM → 0.5 s per beat. */
const SPB = 0.5;

function fixture(): {
  project: DawProject;
  midi: RegionRef;
  audio: RegionRef;
  midiTrackId: string;
  audioTrackId: string;
} {
  const project = newProject('t');
  project.bpm = 120;
  const midiTrack = newTrack('Oud', 'oud');
  const region = newRegion(4, 4);
  region.notes = [
    { id: 'n1', startBeat: 0, lengthBeats: 1, midi: 60, velocity: 0.8 },
    { id: 'n2', startBeat: 1.1, lengthBeats: 0.5, midi: 62, velocity: 0.6 },
    { id: 'n3', startBeat: 2.5, lengthBeats: 1, midi: 64, velocity: 0.7 },
  ];
  midiTrack.regions = [region];
  const audioTrack = newAudioTrack('Vox');
  const clip = newAudioRegion('idb:abc', 'Take 1', 8, 8);
  clip.offsetSec = 1;
  audioTrack.audioRegions = [clip];
  project.tracks = [midiTrack, audioTrack];
  return {
    project,
    midi: { trackId: midiTrack.id, regionId: region.id },
    audio: { trackId: audioTrack.id, regionId: clip.id },
    midiTrackId: midiTrack.id,
    audioTrackId: audioTrack.id,
  };
}

function midiOf(project: DawProject, ref: RegionRef): DawRegion {
  const found = findRegion(project, ref);
  if (found?.region.kind !== 'midi') throw new Error('not midi');
  return found.region;
}

function audioOf(project: DawProject, ref: RegionRef): DawAudioRegion {
  const found = findRegion(project, ref);
  if (found?.region.kind !== 'audio') throw new Error('not audio');
  return found.region;
}

function regionsOn(project: DawProject, trackId: string): AnyRegion[] {
  const track = project.tracks.find((t) => t.id === trackId);
  return track ? [...track.regions, ...(track.audioRegions ?? [])] : [];
}

describe('snap grid', () => {
  it('sizes note values against the beat unit', () => {
    expect(snapBeats('bar', TS44)).toBe(4);
    expect(snapBeats('beat', TS44)).toBe(1);
    expect(snapBeats('1/2', TS44)).toBe(2);
    expect(snapBeats('1/4', TS44)).toBe(1);
    expect(snapBeats('1/8', TS44)).toBe(0.5);
    expect(snapBeats('1/16', TS44)).toBe(0.25);
    expect(snapBeats('1/8T', TS44)).toBeCloseTo(1 / 3);
    expect(snapBeats('1/16T', TS44)).toBeCloseTo(1 / 6);
    expect(snapBeats('off', TS44)).toBeNull();
    expect(snapBeats('bar', { beatsPerBar: 6, beatUnit: 8 })).toBe(6);
    expect(snapBeats('1/16', { beatsPerBar: 6, beatUnit: 8 })).toBe(0.5);
  });

  it('snaps and passes through when off', () => {
    expect(snapBeat(1.3, 0.5)).toBe(1.5);
    expect(snapBeat(1.2, 0.5)).toBe(1);
    expect(snapBeat(1.234, null)).toBe(1.234);
    expect(snapBeat(1 / 3 + 1e-9, 1 / 3)).toBeCloseTo(1 / 3, 6);
  });

  it('quantizes with strength', () => {
    expect(quantizeValue(1.2, 1, 1)).toBe(1);
    expect(quantizeValue(1.2, 1, 0.5)).toBe(1.1);
    expect(quantizeValue(1.2, 1, 0)).toBe(1.2);
  });
});

describe('selection helpers', () => {
  it('toggles, selects all, prunes, and marquees', () => {
    const { project, midi, audio } = fixture();
    expect(toggleRef([midi], midi)).toEqual([]);
    expect(toggleRef([], midi)).toEqual([midi]);
    expect(selectAllRegions(project)).toEqual([midi, audio]);
    expect(pruneSelection(project, [midi, { trackId: 'x', regionId: 'y' }])).toEqual([midi]);
    expect(marqueeRefs(project, { startBeat: 0, endBeat: 5, firstTrack: 0, lastTrack: 1 })).toEqual(
      [midi],
    );
    expect(
      marqueeRefs(project, { startBeat: 7.5, endBeat: 9, firstTrack: 1, lastTrack: 0 }),
    ).toEqual([midi, audio]);
  });
});

describe('move', () => {
  it('moves regions in time without mutating the input', () => {
    const { project, midi, audio } = fixture();
    const { project: next, selection } = moveRegions(project, [midi, audio], 2);
    expect(midiOf(next, midi).startBeat).toBe(6);
    expect(audioOf(next, audio).startBeat).toBe(10);
    expect(midiOf(project, midi).startBeat).toBe(4);
    expect(selection).toEqual([midi, audio]);
  });

  it('clamps so the earliest region stops at zero', () => {
    const { project, midi, audio } = fixture();
    const next = moveRegions(project, [midi, audio], -100).project;
    expect(midiOf(next, midi).startBeat).toBe(0);
    expect(audioOf(next, audio).startBeat).toBe(4);
  });

  it('moves across lanes only onto tracks of the same kind', () => {
    const { project, midi, midiTrackId } = fixture();
    const blocked = moveRegions(project, [midi], 0, 1);
    expect(blocked.selection[0]?.trackId).toBe(midiTrackId);
    const keys = newTrack('Keys', 'keys');
    project.tracks.push(keys);
    // midi (0) → audio (1) is blocked; add a MIDI lane at 2 and move by 2.
    const moved = moveRegions(project, [midi], 0, 2);
    expect(moved.selection[0]?.trackId).toBe(keys.id);
    expect(regionsOn(moved.project, midiTrackId)).toHaveLength(0);
  });

  it('copies with the copy option (⌥-drag)', () => {
    const { project, midi, midiTrackId } = fixture();
    const { project: next, selection } = moveRegions(project, [midi], 8, 0, { copy: true });
    expect(regionsOn(next, midiTrackId)).toHaveLength(2);
    expect(selection[0]?.regionId).not.toBe(midi.regionId);
    const copy = selection[0] ? midiOf(next, selection[0]) : null;
    expect(copy?.startBeat).toBe(12);
    expect(copy?.notes.map((n) => n.midi)).toEqual([60, 62, 64]);
    expect(copy?.notes[0]?.id).not.toBe('n1');
  });
});

describe('trim', () => {
  it('right-trims MIDI non-destructively', () => {
    const { project, midi } = fixture();
    const short = trimRegion(project, midi, 'right', 6, { secPerBeat: SPB });
    expect(midiOf(short, midi).lengthBeats).toBe(2);
    expect(midiOf(short, midi).notes).toHaveLength(3);
  });

  it('left-trims MIDI: start moves, content stays in place', () => {
    const { project, midi } = fixture();
    const next = trimRegion(project, midi, 'left', 5, { secPerBeat: SPB });
    const r = midiOf(next, midi);
    expect(r.startBeat).toBe(5);
    expect(r.lengthBeats).toBe(3);
    expect(r.notes.map((n) => n.id)).toEqual(['n2', 'n3']);
    expect(r.notes[0]?.startBeat).toBeCloseTo(0.1);
    expect(r.notes[1]?.startBeat).toBe(1.5);
  });

  it('left-trims audio by advancing offsetSec', () => {
    const { project, audio } = fixture();
    const next = trimRegion(project, audio, 'left', 10, { secPerBeat: SPB });
    const r = audioOf(next, audio);
    expect(r.startBeat).toBe(10);
    expect(r.lengthBeats).toBe(6);
    expect(r.offsetSec).toBe(2); // 1 s + 2 beats × 0.5 s
  });

  it('left-extends audio only back to the start of the file', () => {
    const { project, audio } = fixture();
    const next = trimRegion(project, audio, 'left', 0, { secPerBeat: SPB });
    const r = audioOf(next, audio);
    expect(r.offsetSec).toBe(0);
    expect(r.startBeat).toBe(6); // 1 s of file = 2 beats earlier
    expect(r.lengthBeats).toBe(10);
  });

  it('never trims below the minimum length', () => {
    const { project, midi, audio } = fixture();
    expect(
      midiOf(trimRegion(project, midi, 'right', 0, { secPerBeat: SPB }), midi).lengthBeats,
    ).toBe(0.25);
    expect(
      audioOf(trimRegion(project, audio, 'left', 99, { secPerBeat: SPB }), audio).lengthBeats,
    ).toBe(0.25);
  });
});

describe('loop', () => {
  it('loop-drags to whole passes and steps loopCount', () => {
    const { project, midi } = fixture();
    expect(midiOf(loopRegionTo(project, midi, 17), midi).loopCount).toBe(3);
    expect(midiOf(loopRegionTo(project, midi, 0), midi).loopCount).toBe(1);
    expect(midiOf(changeLoopCount(project, [midi], 2), midi).loopCount).toBe(3);
    expect(midiOf(changeLoopCount(project, [midi], -5), midi).loopCount).toBe(1);
  });

  it('unrolls looped MIDI into explicit notes', () => {
    const { project, midi } = fixture();
    const looped = midiOf(loopRegionTo(project, midi, 12), midi);
    const flat = unrollMidi(looped);
    expect(flat.loopCount).toBe(1);
    expect(flat.lengthBeats).toBe(8);
    expect(flat.notes.map((n) => n.startBeat)).toEqual([0, 1.1, 2.5, 4, 5.1, 6.5]);
  });
});

describe('split at playhead', () => {
  it('splits MIDI, truncating notes that cross the cut', () => {
    const { project, midi, midiTrackId } = fixture();
    const { project: next, selection } = splitRegionsAt(project, [midi], 7, SPB);
    const regions = regionsOn(next, midiTrackId) as DawRegion[];
    expect(regions).toHaveLength(2);
    const left = midiOf(next, midi);
    expect(left.startBeat).toBe(4);
    expect(left.lengthBeats).toBe(3);
    expect(left.notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(left.notes[2]?.lengthBeats).toBe(0.5); // 2.5 → cut at 3
    const right = selection[0] ? midiOf(next, selection[0]) : null;
    expect(right?.startBeat).toBe(7);
    expect(right?.lengthBeats).toBe(1);
    expect(right?.notes).toHaveLength(0);
  });

  it('splits a looped MIDI region keeping every pass', () => {
    const { project, midi, midiTrackId } = fixture();
    const looped = loopRegionTo(project, midi, 12); // 2 passes, beats 4–12
    const { project: next, selection } = splitRegionsAt(looped, [midi], 9, SPB);
    expect(regionsOn(next, midiTrackId)).toHaveLength(2);
    const left = midiOf(next, midi);
    expect(left.loopCount).toBe(1);
    expect(left.lengthBeats).toBe(5);
    expect(left.notes).toHaveLength(4); // 3 + the first note of pass 2
    const right = selection[0] ? midiOf(next, selection[0]) : null;
    expect(right?.startBeat).toBe(9);
    expect(right?.notes.map((n) => n.midi)).toEqual([62, 64]);
    expect(right?.notes[0]?.startBeat).toBeCloseTo(0.1);
  });

  it('splits audio, advancing the right piece’s offset', () => {
    const { project, audio, audioTrackId } = fixture();
    const { project: next, selection } = splitRegionsAt(project, [audio], 11, SPB);
    expect(regionsOn(next, audioTrackId)).toHaveLength(2);
    const left = audioOf(next, audio);
    expect(left.lengthBeats).toBe(3);
    expect(left.offsetSec).toBe(1);
    const right = selection[0] ? audioOf(next, selection[0]) : null;
    expect(right?.startBeat).toBe(11);
    expect(right?.lengthBeats).toBe(5);
    expect(right?.offsetSec).toBe(2.5);
    expect(right?.name).toBe('Take 1');
  });

  it('splits looped audio into whole and partial passes', () => {
    const { project, audio, audioTrackId } = fixture();
    const looped = changeLoopCount(project, [audio], 2); // 3 passes of 8, beats 8–32
    const { project: next, selection } = splitRegionsAt(looped, [audio], 18, SPB);
    const pieces = (regionsOn(next, audioTrackId) as DawAudioRegion[]).sort(
      (a, b) => a.startBeat - b.startBeat,
    );
    expect(pieces.map((p) => [p.startBeat, p.lengthBeats, p.loopCount, p.offsetSec])).toEqual([
      [8, 8, 1, 1],
      [16, 2, 1, 1],
      [18, 6, 1, 2],
      [24, 8, 1, 1],
    ]);
    expect(selection).toHaveLength(2);
  });

  it('splits looped audio exactly on a pass boundary into two looped regions', () => {
    const { project, audio, audioTrackId } = fixture();
    const looped = changeLoopCount(project, [audio], 2);
    const next = splitRegionsAt(looped, [audio], 16, SPB).project;
    const pieces = (regionsOn(next, audioTrackId) as DawAudioRegion[]).sort(
      (a, b) => a.startBeat - b.startBeat,
    );
    expect(pieces.map((p) => [p.startBeat, p.loopCount])).toEqual([
      [8, 1],
      [16, 2],
    ]);
  });

  it('leaves regions the playhead is not inside', () => {
    const { project, midi, midiTrackId } = fixture();
    const { project: next, selection } = splitRegionsAt(project, [midi], 4, SPB);
    expect(regionsOn(next, midiTrackId)).toHaveLength(1);
    expect(selection).toEqual([midi]);
  });
});

describe('duplicate, delete, copy/cut/paste', () => {
  it('duplicates the selection as a block after its end', () => {
    const { project, midi, audio, midiTrackId, audioTrackId } = fixture();
    const { project: next, selection } = duplicateRegions(project, [midi, audio]);
    // block spans 4–16 → copies land 12 beats later
    expect(selection).toHaveLength(2);
    const [m, a] = selection;
    expect(m && midiOf(next, m).startBeat).toBe(16);
    expect(a && audioOf(next, a).startBeat).toBe(20);
    expect(m?.trackId).toBe(midiTrackId);
    expect(a?.trackId).toBe(audioTrackId);
    expect(a && audioOf(next, a).source).toBe('idb:abc');
  });

  it('deletes', () => {
    const { project, midi, audio, midiTrackId, audioTrackId } = fixture();
    const next = deleteRegions(project, [midi, audio]).project;
    expect(regionsOn(next, midiTrackId)).toHaveLength(0);
    expect(regionsOn(next, audioTrackId)).toHaveLength(0);
  });

  it('copy + paste at the playhead returns items to their tracks', () => {
    const { project, midi, audio, midiTrackId, audioTrackId } = fixture();
    const clip = copyRegions(project, [midi, audio]);
    expect(clip?.spanBeats).toBe(12);
    if (!clip) return;
    const { project: next, selection } = pasteRegions(project, clip, 32);
    expect(selection).toHaveLength(2);
    expect(
      regionsOn(next, midiTrackId)
        .map((r) => r.startBeat)
        .sort(),
    ).toEqual([32, 4]);
    expect(
      regionsOn(next, audioTrackId)
        .map((r) => r.startBeat)
        .sort((a, b) => a - b),
    ).toEqual([8, 36]);
  });

  it('pastes onto a target track of the right kind', () => {
    const { project, midi } = fixture();
    const keys = newTrack('Keys', 'keys');
    project.tracks.push(keys);
    const clip = copyRegions(project, [midi]);
    if (!clip) throw new Error('no clip');
    const { selection } = pasteRegions(project, clip, 0, keys.id);
    expect(selection[0]?.trackId).toBe(keys.id);
  });

  it('cut = copy + delete; paste after a cut restores the content', () => {
    const { project, midi, midiTrackId } = fixture();
    const cut = cutRegions(project, [midi]);
    expect(regionsOn(cut.project, midiTrackId)).toHaveLength(0);
    if (!cut.clipboard) throw new Error('no clip');
    const pasted = pasteRegions(cut.project, cut.clipboard, 4);
    const r = pasted.selection[0] ? midiOf(pasted.project, pasted.selection[0]) : null;
    expect(r?.notes.map((n) => n.midi)).toEqual([60, 62, 64]);
  });
});

describe('join, rename, quantize', () => {
  it('joins MIDI regions on a track', () => {
    const { project, midi, midiTrackId } = fixture();
    const second = newRegion(10, 2);
    second.notes = [{ id: 'm1', startBeat: 0.5, lengthBeats: 1, midi: 67, velocity: 1 }];
    project.tracks[0]?.regions.push(second);
    const { project: next, selection } = joinRegions(project, [
      midi,
      { trackId: midiTrackId, regionId: second.id },
    ]);
    expect(regionsOn(next, midiTrackId)).toHaveLength(1);
    const joined = selection[0] ? midiOf(next, selection[0]) : null;
    expect(joined?.startBeat).toBe(4);
    expect(joined?.lengthBeats).toBe(8);
    expect(joined?.notes.map((n) => n.startBeat)).toEqual([0, 1.1, 2.5, 6.5]);
  });

  it('does not join audio or single regions', () => {
    const { project, midi, audio, audioTrackId } = fixture();
    const { project: next, selection } = joinRegions(project, [midi, audio]);
    expect(regionsOn(next, audioTrackId)).toHaveLength(1);
    expect(selection).toEqual([midi]);
  });

  it('renames MIDI and audio regions', () => {
    const { project, midi, audio } = fixture();
    expect(regionName(midiOf(project, midi), 'Oud')).toBe('Oud');
    const named = renameRegion(project, midi, '  Verse  ');
    expect(regionName(midiOf(named, midi))).toBe('Verse');
    expect(audioOf(renameRegion(project, audio, 'Lead'), audio).name).toBe('Lead');
  });

  it('quantizes selected notes at a strength', () => {
    const { project, midi } = fixture();
    const full = midiOf(quantizeNotes(project, midi, ['n2'], 0.5, 1), midi);
    expect(full.notes.find((n) => n.id === 'n2')?.startBeat).toBe(1);
    expect(full.notes.find((n) => n.id === 'n3')?.startBeat).toBe(2.5);
    const half = midiOf(quantizeNotes(project, midi, null, 1, 0.5), midi);
    expect(half.notes.map((n) => n.startBeat)).toEqual([0, 1.05, 2.75]);
  });

  it('never quantizes a note onto the region end', () => {
    const { project, midi } = fixture();
    const near = moveNotes(project, midi, ['n3'], 1.3, 0); // n3 → 3.8
    const q = midiOf(quantizeNotes(near, midi, ['n3'], 1, 1), midi);
    expect(q.notes.find((n) => n.id === 'n3')?.startBeat).toBe(3);
  });

  it('quantizes whole regions', () => {
    const { project, midi, audio } = fixture();
    const q = midiOf(quantizeRegions(project, [midi, audio], 1, 1), midi);
    expect(q.notes.map((n) => n.startBeat)).toEqual([0, 1, 3]);
  });
});

describe('note editing', () => {
  it('moves notes within the region and pitch range', () => {
    const { project, midi } = fixture();
    const next = midiOf(moveNotes(project, midi, ['n1', 'n2'], -1, 2), midi);
    expect(next.notes.find((n) => n.id === 'n1')?.startBeat).toBe(0); // clamped
    expect(next.notes.find((n) => n.id === 'n1')?.midi).toBe(62);
    const mapped = midiOf(
      moveNotes(project, midi, ['n1'], 0, 1, (m) => m + 1),
      midi,
    );
    expect(mapped.notes.find((n) => n.id === 'n1')?.midi).toBe(62);
  });

  it('resizes, deletes, sets velocity', () => {
    const { project, midi } = fixture();
    expect(midiOf(resizeNotes(project, midi, ['n1'], -5), midi).notes[0]?.lengthBeats).toBe(1 / 32);
    expect(midiOf(deleteNotes(project, midi, ['n1']), midi).notes).toHaveLength(2);
    expect(
      midiOf(setNotesVelocity(project, midi, ['n1', 'n2'], 0.25), midi).notes[1]?.velocity,
    ).toBe(0.25);
  });

  it('box-selects, copies and pastes notes', () => {
    const { project, midi } = fixture();
    const region = midiOf(project, midi);
    expect(notesInBox(region, { startBeat: 0.5, endBeat: 3, lowMidi: 61, highMidi: 70 })).toEqual([
      'n2',
      'n3',
    ]);
    const clip = copyNotes(region, ['n2', 'n3']);
    expect(clip?.notes.map((n) => n.startBeat)).toEqual([0, 1.4]);
    if (!clip) return;
    const { project: next, noteIds } = pasteNotes(project, midi, clip, 3);
    expect(noteIds).toHaveLength(1); // the second lands past the 4-beat end
    expect(midiOf(next, midi).notes).toHaveLength(4);
  });
});

describe('recording', () => {
  it('builds a bar-aligned region from a take', () => {
    const region = buildRecordedRegion(
      [
        { midi: 60, velocity: 0.8, startBeat: 5.2, endBeat: 5.9 },
        { midi: 64, velocity: 0.5, startBeat: 9.5, endBeat: 9.5 },
      ],
      4,
    );
    expect(region?.startBeat).toBe(4);
    expect(region?.lengthBeats).toBe(8);
    expect(region?.notes.map((n) => [n.startBeat, n.lengthBeats])).toEqual([
      [1.2, 0.7],
      [5.5, 1 / 32],
    ]);
    expect(buildRecordedRegion([], 4)).toBeNull();
  });

  it('accepts engine audio regions only onto audio tracks', () => {
    const { project, midiTrackId, audioTrackId } = fixture();
    const clip = newAudioRegion('idb:rec', 'Recording', 0, 4);
    expect(isAudioRegion(clip)).toBe(true);
    expect(isAudioRegion({ kind: 'audio' })).toBe(false);
    expect(insertAudioRegion(project, midiTrackId, clip).selection).toEqual([]);
    const ok = insertAudioRegion(project, audioTrackId, clip);
    expect(regionsOn(ok.project, audioTrackId)).toHaveLength(2);
  });
});

describe('markers and tracks', () => {
  it('adds, renames, jumps between and deletes markers', () => {
    const { project } = fixture();
    const a = addMarker(project, 8, 'Chorus');
    const b = addMarker(a.project, 2);
    expect(b.project.markers?.map((m) => m.name)).toEqual(['Marker 2', 'Chorus']);
    expect(adjacentMarkerBeat(b.project, 4, 1)).toBe(8);
    expect(adjacentMarkerBeat(b.project, 4, -1)).toBe(2);
    expect(adjacentMarkerBeat(b.project, 8, 1)).toBeNull();
    const renamed = renameMarker(b.project, a.markerId, 'Refrain');
    expect(renamed.markers?.find((m) => m.id === a.markerId)?.name).toBe('Refrain');
    expect(deleteMarker(renamed, a.markerId).markers).toHaveLength(1);
    expect(project.markers).toBeUndefined();
  });

  it('reorders, recolours and deletes tracks', () => {
    const { project, midiTrackId, audioTrackId } = fixture();
    expect(moveTrack(project, 0, 1).tracks.map((t) => t.id)).toEqual([audioTrackId, midiTrackId]);
    const coloured = setTrackColor(project, midiTrackId, '#123456');
    expect(coloured.tracks[0] && trackColor(coloured.tracks[0], 0)).toBe('#123456');
    expect(project.tracks[1] && trackColor(project.tracks[1], 1)).toBe('#5F9BC8');
    expect(deleteTrack(project, midiTrackId).tracks).toHaveLength(1);
  });
});

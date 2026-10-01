import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, commit, initHistory, redo, replacePresent, undo } from '../history';

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = initHistory('a');
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('undoes and redoes in order', () => {
    let h = initHistory('a');
    h = commit(h, 'b', { now: 0 });
    h = commit(h, 'c', { now: 10_000 });
    expect(h.present).toBe('c');
    h = undo(h);
    expect(h.present).toBe('b');
    h = undo(h);
    expect(h.present).toBe('a');
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe('b');
    h = redo(h);
    expect(h.present).toBe('c');
    expect(canRedo(h)).toBe(false);
  });

  it('a new commit clears the redo stack', () => {
    let h = initHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = commit(h, 4);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual([1, 2]);
  });

  it('coalesces commits that share a key inside the window', () => {
    let h = initHistory(0);
    h = commit(h, 1, { coalesceKey: 'drag:1', now: 1000 });
    h = commit(h, 2, { coalesceKey: 'drag:1', now: 1100 });
    h = commit(h, 3, { coalesceKey: 'drag:1', now: 1200 });
    expect(h.present).toBe(3);
    expect(h.past).toEqual([0]);
    h = undo(h);
    expect(h.present).toBe(0);
  });

  it('does not coalesce different keys, keyless commits, or stale windows', () => {
    let h = initHistory(0);
    h = commit(h, 1, { coalesceKey: 'drag:1', now: 0 });
    h = commit(h, 2, { coalesceKey: 'drag:2', now: 10 });
    h = commit(h, 3, { now: 20 });
    h = commit(h, 4, { now: 30 });
    h = commit(h, 5, { coalesceKey: 'k', now: 40 });
    h = commit(h, 6, { coalesceKey: 'k', now: 40 + 60_000 });
    expect(h.past).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('undo breaks coalescing so the next drag is its own step', () => {
    let h = initHistory(0);
    h = commit(h, 1, { coalesceKey: 'k', now: 0 });
    h = undo(h);
    h = commit(h, 2, { coalesceKey: 'k', now: 1 });
    expect(h.past).toEqual([0]);
    expect(h.present).toBe(2);
  });

  it('is bounded', () => {
    let h = initHistory(0);
    for (let i = 1; i <= 20; i++) h = commit(h, i, { limit: 5 });
    expect(h.past).toEqual([15, 16, 17, 18, 19]);
    expect(h.present).toBe(20);
  });

  it('replacePresent does not add a step', () => {
    let h = commit(initHistory('a'), 'b');
    h = replacePresent(h, 'B');
    expect(h.present).toBe('B');
    expect(h.past).toEqual(['a']);
  });
});

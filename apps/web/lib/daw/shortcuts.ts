/**
 * Studio keyboard shortcuts (Studio v2) — the single source of truth. The
 * key handler (DawApp) asks `matchShortcut` what a key press means, and the
 * "?" overlay renders `SHORTCUTS` verbatim, so the help can never disagree
 * with the behaviour.
 *
 * ⌘ means Command on macOS and Ctrl elsewhere (either is accepted). Letter
 * keys match on the PHYSICAL key (`KeyboardEvent.code`) so ⌥M still means
 * "M" on a Mac, where the character becomes "µ".
 */

export type ShortcutId =
  | 'play'
  | 'toStart'
  | 'record'
  | 'cycle'
  | 'metronome'
  | 'barBack'
  | 'barForward'
  | 'prevMarker'
  | 'nextMarker'
  | 'addMarker'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'split'
  | 'join'
  | 'delete'
  | 'selectAll'
  | 'deselect'
  | 'quantize'
  | 'transposeUp'
  | 'transposeDown'
  | 'octaveUp'
  | 'octaveDown'
  | 'zoomIn'
  | 'zoomOut'
  | 'musicalTyping'
  | 'library'
  | 'inspector'
  | 'help';

export type ShortcutGroup =
  'Transport' | 'Editing' | 'Notes' | 'View' | 'Markers' | 'Musical typing';

interface KeyMatch {
  /** KeyboardEvent.code (physical key). */
  code?: string;
  /** KeyboardEvent.key (character / named key). */
  key?: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Shortcut {
  id: ShortcutId | null;
  /** Display form, e.g. "⇧⌘Z". */
  keys: string;
  description: string;
  group: ShortcutGroup;
  match: readonly KeyMatch[];
}

/** Plain-letter shortcuts that musical typing takes over while it is on. */
const TYPING_CONFLICTS = new Set(['KeyC', 'KeyK', 'KeyS', 'KeyY']);

export const SHORTCUTS: readonly Shortcut[] = [
  // Transport
  {
    id: 'play',
    keys: 'Space',
    description: 'Play / stop',
    group: 'Transport',
    match: [{ code: 'Space' }],
  },
  {
    id: 'toStart',
    keys: 'Return',
    description: 'Go to the start',
    group: 'Transport',
    match: [{ key: 'Enter' }],
  },
  {
    id: 'record',
    keys: 'R',
    description: 'Record into the armed track (again to stop)',
    group: 'Transport',
    match: [{ code: 'KeyR' }],
  },
  {
    id: 'cycle',
    keys: 'C',
    description: 'Cycle (loop) on / off',
    group: 'Transport',
    match: [{ code: 'KeyC' }],
  },
  {
    id: 'metronome',
    keys: 'K',
    description: 'Metronome on / off',
    group: 'Transport',
    match: [{ code: 'KeyK' }],
  },
  {
    id: 'barBack',
    keys: '←',
    description: 'Playhead back one bar',
    group: 'Transport',
    match: [{ key: 'ArrowLeft' }],
  },
  {
    id: 'barForward',
    keys: '→',
    description: 'Playhead forward one bar',
    group: 'Transport',
    match: [{ key: 'ArrowRight' }],
  },
  // Editing
  {
    id: 'undo',
    keys: '⌘Z',
    description: 'Undo',
    group: 'Editing',
    match: [{ code: 'KeyZ', mod: true }],
  },
  {
    id: 'redo',
    keys: '⇧⌘Z',
    description: 'Redo',
    group: 'Editing',
    match: [{ code: 'KeyZ', mod: true, shift: true }],
  },
  {
    id: 'copy',
    keys: '⌘C',
    description: 'Copy regions (or notes in the editor)',
    group: 'Editing',
    match: [{ code: 'KeyC', mod: true }],
  },
  {
    id: 'cut',
    keys: '⌘X',
    description: 'Cut regions (or notes)',
    group: 'Editing',
    match: [{ code: 'KeyX', mod: true }],
  },
  {
    id: 'paste',
    keys: '⌘V',
    description: 'Paste at the playhead',
    group: 'Editing',
    match: [{ code: 'KeyV', mod: true }],
  },
  {
    id: 'duplicate',
    keys: '⌘D',
    description: 'Duplicate after the selection',
    group: 'Editing',
    match: [{ code: 'KeyD', mod: true }],
  },
  {
    id: 'split',
    keys: '⌘T  ·  S',
    description: 'Split regions at the playhead (S where the browser keeps ⌘T)',
    group: 'Editing',
    match: [{ code: 'KeyT', mod: true }, { code: 'KeyS' }],
  },
  {
    id: 'join',
    keys: '⌘J',
    description: 'Join selected MIDI regions on a track',
    group: 'Editing',
    match: [{ code: 'KeyJ', mod: true }],
  },
  {
    id: 'delete',
    keys: '⌫',
    description: 'Delete selection',
    group: 'Editing',
    match: [{ key: 'Backspace' }, { key: 'Delete' }],
  },
  {
    id: 'selectAll',
    keys: '⌘A',
    description: 'Select all (regions, or notes in the editor)',
    group: 'Editing',
    match: [{ code: 'KeyA', mod: true }],
  },
  {
    id: 'deselect',
    keys: 'Esc',
    description: 'Clear the selection / close overlays',
    group: 'Editing',
    match: [{ key: 'Escape' }],
  },
  {
    id: 'quantize',
    keys: 'Q',
    description: 'Quantize selected notes (or regions) to the snap grid',
    group: 'Editing',
    match: [{ code: 'KeyQ' }],
  },
  // Notes
  {
    id: 'transposeUp',
    keys: '↑',
    description: 'Selected notes up a semitone',
    group: 'Notes',
    match: [{ key: 'ArrowUp' }],
  },
  {
    id: 'transposeDown',
    keys: '↓',
    description: 'Selected notes down a semitone',
    group: 'Notes',
    match: [{ key: 'ArrowDown' }],
  },
  {
    id: 'octaveUp',
    keys: '⇧↑',
    description: 'Selected notes up an octave',
    group: 'Notes',
    match: [{ key: 'ArrowUp', shift: true }],
  },
  {
    id: 'octaveDown',
    keys: '⇧↓',
    description: 'Selected notes down an octave',
    group: 'Notes',
    match: [{ key: 'ArrowDown', shift: true }],
  },
  // View
  {
    id: 'zoomIn',
    keys: '⌘+',
    description: 'Zoom in (also ⌃/⌘ + scroll, trackpad pinch)',
    group: 'View',
    match: [
      { code: 'Equal', mod: true },
      { code: 'Equal', mod: true, shift: true },
      { code: 'NumpadAdd', mod: true },
    ],
  },
  {
    id: 'zoomOut',
    keys: '⌘−',
    description: 'Zoom out',
    group: 'View',
    match: [
      { code: 'Minus', mod: true },
      { code: 'NumpadSubtract', mod: true },
    ],
  },
  {
    id: 'musicalTyping',
    keys: '⌘K',
    description: 'Musical typing on / off',
    group: 'View',
    match: [{ code: 'KeyK', mod: true }],
  },
  {
    id: 'library',
    keys: 'Y',
    description: 'Library pane on / off',
    group: 'View',
    match: [{ code: 'KeyY' }],
  },
  {
    id: 'inspector',
    keys: 'I',
    description: 'Inspector pane on / off',
    group: 'View',
    match: [{ code: 'KeyI' }],
  },
  {
    id: 'help',
    keys: '?',
    description: 'Show this list',
    group: 'View',
    match: [{ key: '?' }, { key: '?', shift: true }],
  },
  // Markers
  {
    id: 'addMarker',
    keys: '⌥M',
    description: 'Add a marker at the playhead',
    group: 'Markers',
    match: [{ code: 'KeyM', alt: true }],
  },
  {
    id: 'prevMarker',
    keys: '⌥←',
    description: 'Jump to the previous marker',
    group: 'Markers',
    match: [{ key: 'ArrowLeft', alt: true }],
  },
  {
    id: 'nextMarker',
    keys: '⌥→',
    description: 'Jump to the next marker',
    group: 'Markers',
    match: [{ key: 'ArrowRight', alt: true }],
  },
  // Musical typing (handled by lib/daw/musicalTyping.ts — listed for the overlay)
  {
    id: null,
    keys: 'A S D F G H J K',
    description: 'White keys C D E F G A B C (L ; ’ continue)',
    group: 'Musical typing',
    match: [],
  },
  {
    id: null,
    keys: 'W E T Y U',
    description: 'Black keys C♯ D♯ F♯ G♯ A♯ (O P continue)',
    group: 'Musical typing',
    match: [],
  },
  { id: null, keys: 'Z / X', description: 'Octave down / up', group: 'Musical typing', match: [] },
  {
    id: null,
    keys: 'C / V',
    description: 'Velocity down / up',
    group: 'Musical typing',
    match: [],
  },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  'Transport',
  'Editing',
  'Notes',
  'View',
  'Markers',
  'Musical typing',
];

export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

function matches(event: KeyLike, m: KeyMatch): boolean {
  if (m.code !== undefined && event.code !== m.code) return false;
  if (m.key !== undefined && event.key !== m.key) return false;
  const mod = event.metaKey || event.ctrlKey;
  if ((m.mod ?? false) !== mod) return false;
  if ((m.alt ?? false) !== event.altKey) return false;
  if ((m.shift ?? false) !== event.shiftKey) return false;
  return true;
}

/**
 * What a key press means, or null. With musical typing on, the plain-letter
 * shortcuts that share a key with the typing keyboard (C, K, S) yield to it.
 */
export function matchShortcut(
  event: KeyLike,
  options: { musicalTyping?: boolean } = {},
): ShortcutId | null {
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
  if (options.musicalTyping === true && plain && TYPING_CONFLICTS.has(event.code)) return null;
  for (const shortcut of SHORTCUTS) {
    if (shortcut.id === null) continue;
    if (shortcut.match.some((m) => matches(event, m))) return shortcut.id;
  }
  return null;
}

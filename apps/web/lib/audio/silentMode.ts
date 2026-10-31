/**
 * Sound on iPhones with the ring/silent switch on.
 *
 * iOS puts Web Audio (the studio, the score and MIDI players, the home and
 * Listen pages) in the "ambient" audio session, which the silent switch mutes,
 * while an <audio> element plays as media and is heard. Two remedies:
 *
 *  • iOS 17+: `navigator.audioSession.type = 'playback'` says the page plays
 *    media; Web Audio then ignores the switch.
 *  • older iOS: while a silent <audio> element loops, the page holds the
 *    playback session and Web Audio is heard too. It must start inside a user
 *    gesture, so it starts on the first tap and pauses when the page is hidden.
 *
 * Other browsers have no such switch and are left alone.
 */

interface AudioSessionLike {
  type: string;
}

/** A short silent mono 16-bit WAV (8 kHz), for the looping fallback element. */
export function silentWav(seconds = 0.5, rate = 8000): Uint8Array {
  const samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

/** iPhone, iPod, or an iPad that reports itself as a Mac but has touch. */
export function isAppleTouchDevice(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>): boolean {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
  );
}

/**
 * Install once per page. Returns an uninstall function. Safe to call where
 * the browser has nothing to fix (it does nothing there).
 */
export function keepSoundInSilentMode(win: Window = window): () => void {
  const nav = win.navigator as Navigator & { audioSession?: AudioSessionLike };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch {
      // Older WebKit builds expose the object read-only; the fallback below still runs.
    }
    if (nav.audioSession.type === 'playback') return () => undefined;
  }
  if (!isAppleTouchDevice(nav)) return () => undefined;

  const doc = win.document;
  const url = URL.createObjectURL(new Blob([silentWav() as BlobPart], { type: 'audio/wav' }));
  const el = doc.createElement('audio');
  el.src = url;
  el.loop = true;
  el.setAttribute('playsinline', '');
  el.setAttribute('x-webkit-airplay', 'deny');
  el.preload = 'auto';

  const start = (): void => {
    if (doc.visibilityState !== 'visible' || !el.paused) return;
    void el.play().catch(() => undefined);
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') el.pause();
  };
  const gestures = ['touchend', 'pointerup', 'click', 'keydown'] as const;
  for (const g of gestures) doc.addEventListener(g, start, { capture: true, passive: true });
  doc.addEventListener('visibilitychange', onVisibility);

  return () => {
    for (const g of gestures) doc.removeEventListener(g, start, { capture: true });
    doc.removeEventListener('visibilitychange', onVisibility);
    el.pause();
    el.removeAttribute('src');
    URL.revokeObjectURL(url);
  };
}

import { describe, expect, it } from 'vitest';
import { isAppleTouchDevice, keepSoundInSilentMode, silentWav } from '../silentMode';

describe('silent-mode playback', () => {
  it('builds a valid silent PCM WAV', () => {
    const wav = silentWav(0.5, 8000);
    const view = new DataView(wav.buffer);
    const tag = (at: number): string => String.fromCharCode(...wav.slice(at, at + 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(36)).toBe('data');
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(8000);
    expect(wav.length).toBe(44 + 8000);
    expect(wav.slice(44).every((b) => b === 0)).toBe(true);
  });

  it('recognises iPhones and touch iPads, not desktops or Android', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0';
    expect(isAppleTouchDevice({ userAgent: iphone, maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: mac, maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: mac, maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouchDevice({ userAgent: android, maxTouchPoints: 5 })).toBe(false);
  });

  it('switches the audio session to playback where the browser offers it', () => {
    const session = { type: 'auto' };
    const win = { navigator: { audioSession: session, userAgent: 'iPhone', maxTouchPoints: 5 } };
    const undo = keepSoundInSilentMode(win as unknown as Window);
    expect(session.type).toBe('playback');
    undo();
  });

  it('does nothing on browsers without the switch', () => {
    const win = { navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0 } };
    expect(() => keepSoundInSilentMode(win as unknown as Window)()).not.toThrow();
  });
});

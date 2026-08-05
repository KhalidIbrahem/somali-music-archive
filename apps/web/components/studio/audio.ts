/**
 * Shared audio plumbing for the studio (B1-04/05).
 *
 * One AudioContext and one decoded sample buffer per page, cached at module
 * scope: the waveform strip draws from exactly the same buffer the transport
 * plays, so the two can never disagree about what the audio contains.
 */

let audioContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext();
  return audioContext;
}

let bufferPromise: Promise<AudioBuffer> | null = null;

export function loadSampleBuffer(): Promise<AudioBuffer> {
  bufferPromise ??= (async () => {
    const res = await fetch('/sample/audio.mp3');
    if (!res.ok) throw new Error(`audio fetch failed (${res.status})`);
    const bytes = await res.arrayBuffer();
    return getAudioContext().decodeAudioData(bytes);
  })();
  return bufferPromise;
}

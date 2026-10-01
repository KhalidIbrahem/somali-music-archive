'use client';

/** A <midi-player> for a MIDI file URL (piano sound font), loaded client-side only. */

import { useEffect, useState } from 'react';

const SOUND_FONT = 'https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus';

export function MidiPlay({ src }: { src: string }): React.JSX.Element | null {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void import('html-midi-player').then(() => setReady(true));
  }, []);
  return ready ? <midi-player src={src} sound-font={SOUND_FONT} className="block w-full" /> : null;
}

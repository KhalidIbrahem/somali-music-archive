'use client';

/** Keeps the site's Web Audio players audible on iPhones in silent mode (lib/audio/silentMode.ts). */

import { useEffect } from 'react';
import { keepSoundInSilentMode } from '@/lib/audio/silentMode';

export function SilentModeAudio(): null {
  useEffect(() => keepSoundInSilentMode(), []);
  return null;
}

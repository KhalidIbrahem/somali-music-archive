/**
 * /studio/transcribe — the QaraamiGen transcription tool (server shell).
 * Interactive flow lives in components/studio/StudioTranscribe.tsx.
 */

import type { Metadata } from 'next';
import { StudioTranscribe } from '@/components/studio/StudioTranscribe';

export const metadata: Metadata = {
  title: 'Transcribe — QaraamiGen Studio',
  description:
    'Upload a Somali music recording and get an engraved score — choose voice, kaban, violin, flute, or the full arrangement.',
};

export default function StudioTranscribePage(): React.JSX.Element {
  return <StudioTranscribe />;
}

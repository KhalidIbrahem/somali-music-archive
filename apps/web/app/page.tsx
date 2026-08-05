/**
 * Landing page (/) — the dedicated music-AI face of the platform, in the
 * QaraamiGen visual system with the dark/light theme toggle. The interactive
 * shell lives in components/home/QaraamiHome.tsx; the previous amber archive
 * landing is preserved in git history (superseded 2026-08-05 by the product
 * redesign).
 */

import type { Metadata } from 'next';
import { QaraamiHome } from '@/components/home/QaraamiHome';

export const metadata: Metadata = {
  title: 'Somali Music AI — Transcription, Generation & the Archive',
  description:
    'Music AI built for the Somali tradition: transcribe recordings into professional sheet music, generate new pieces in the spirit of qaraami, and explore the restored archive.',
};

export default function Home(): React.JSX.Element {
  return <QaraamiHome />;
}

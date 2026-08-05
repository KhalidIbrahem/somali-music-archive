/**
 * /reader — the read-only score reader on the sample session (B1-08).
 * Reachable without an account: it is the mobile face of the studio's
 * engraved output, and the welcome screen links straight to it.
 */

import { ScoreReader } from '@/components/reader/ScoreReader';

export default function ReaderRoute(): React.JSX.Element {
  return <ScoreReader />;
}

import { redirect } from 'next/navigation';

/** The studio moved to /studio; keep old links working. */
export default function DawPage(): never {
  redirect('/studio');
}

import { redirect } from 'next/navigation';

/** Alias — the dashboard lives at /account; both names should just work. */
export default function DashboardAlias(): never {
  redirect('/account');
}

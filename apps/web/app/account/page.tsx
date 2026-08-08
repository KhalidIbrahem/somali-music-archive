import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { Dashboard } from '@/components/dashboard/Dashboard';

export const metadata: Metadata = {
  title: 'Dashboard — QaraamiGenAI',
  description: 'My Studio, Courses, Library, and platform administration.',
};

export default function AccountPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-page text-hi">
      <SiteHeader />
      <Dashboard />
    </div>
  );
}

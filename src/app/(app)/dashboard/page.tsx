import type { Metadata } from 'next';
import { loadShellData } from '../layout';
import { Dashboard } from './dashboard';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const { user, profile } = await loadShellData();
  return <Dashboard user={user.view} profile={profile} />;
}

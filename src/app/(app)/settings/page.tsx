import type { Metadata } from 'next';
import { loadShellData } from '../layout';
import { Settings } from './settings';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const { user, profile } = await loadShellData();
  return <Settings user={user.view} profile={profile} />;
}

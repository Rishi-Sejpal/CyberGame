import type { Metadata } from 'next';
import { ComingSoon, COMING_SOON_METADATA } from '@/components/app/coming-soon';

export const metadata: Metadata = { title: 'Profile', ...COMING_SOON_METADATA };

export default function Page() {
  return <ComingSoon route="/profile" />;
}

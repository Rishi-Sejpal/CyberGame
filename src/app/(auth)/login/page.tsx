import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { LoginForm } from './login-form';
import { sanitizeNextPath } from '@/lib/navigation';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to continue your cybersecurity training on CYBERGRID.',
  robots: { index: false, follow: false },
};

/**
 * `/login`
 *
 * A Server Component: it validates the `next` parameter *before* rendering the
 * form. That matters because the middleware writes `next` from the pathname and
 * the value ends up in a client-side redirect after sign-in. Sanitising here
 * means a crafted `/login?next=https://evil.example` can never become a
 * post-login redirect, even if this check were later removed from the client.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);

  if (params.error === 'unverified') {
    redirect('/verify-email?notice=required');
  }

  return <LoginForm nextPath={next} />;
}

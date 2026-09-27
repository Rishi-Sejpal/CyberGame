import type { Metadata } from 'next';
import { VerifyEmailForm } from './verify-email-form';
import { tokenFromUrlParam } from '@/shared/form-validation';

export const metadata: Metadata = {
  title: 'Verify your email',
  robots: { index: false, follow: false },
};

/**
 * `/verify-email`
 *
 * Verification is a POST, not a GET: the link in the email is consumed on click,
 * and a GET would make a mail scanner or a chat preview fetch burn the token
 * before the player ever saw it. The page reads the token from the query string
 * and hands it to the client, which posts it.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = tokenFromUrlParam(params.token);
  const notice = typeof params.notice === 'string' ? params.notice : null;

  return <VerifyEmailForm token={token} notice={notice} />;
}

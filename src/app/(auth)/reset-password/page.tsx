import type { Metadata } from 'next';
import { ResetPasswordForm } from './reset-password-form';
import { tokenFromUrlParam } from '@/shared/form-validation';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
};

/**
 * `/reset-password`
 *
 * The token is read from the query string and shape-checked in the Server
 * Component, so a link with a missing or malformed token renders an explanation
 * instead of a form that is guaranteed to fail. The token is still sent to the
 * server for real validation — this check exists purely for the player's
 * benefit, and the server is the only thing that decides whether it is valid.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = tokenFromUrlParam(params.token);

  return <ResetPasswordForm token={token} />;
}

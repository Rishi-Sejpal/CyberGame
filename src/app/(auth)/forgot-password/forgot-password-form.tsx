'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Button } from '@/components/ui/primitives';
import { Field } from '@/components/ui/form';
import { errorMessage } from '@/lib/api-client';
import { authApi } from '@/components/auth/auth-provider';
import { validateEmail } from '@/shared/form-validation';
import { useCooldown } from '@/lib/use-cooldown';

/**
 * "Forgot password".
 *
 * The endpoint returns the same 202 whether or not the address is registered,
 * and this form mirrors that by showing the same confirmation in both cases.
 * Saying "no such account" here would turn this page into an account-existence
 * oracle for anyone with a list of email addresses.
 *
 * The player is told to check the mailbox regardless, so the UI stays honest
 * without being useless.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const cooldown = useCooldown();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown.active) return;

    const invalid = validateEmail(email);
    setFieldError(invalid);
    if (invalid) return;

    setBanner(null);
    setPending(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSubmitted(true);
    } catch (error) {
      setBanner(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (submitted) {
    return (
      <div className="panel px-6 py-7 sm:px-7">
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">Check your inbox</p>
        <h1 className="mt-2 text-lg">Reset link sent</h1>
        <div className="mt-4 space-y-4">
          <Alert tone="success" title="If that address has an account, a reset link is on its way.">
            The link expires in 60 minutes and can be used once. If nothing arrives within a few
            minutes, check your spam folder before requesting another.
          </Alert>
          <div className="flex flex-col gap-2 text-xs">
            <Link href="/login" className="font-semibold text-neon hover:underline">
              Back to sign in
            </Link>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="text-left text-ink-faint hover:text-ink"
            >
              Use a different email address
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel px-6 py-7 sm:px-7">
      <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">Account recovery</p>
      <h1 className="mt-2 text-lg">Reset your password</h1>
      <p className="mt-1.5 text-xs text-ink-dim">
        Enter the email address on your account and we will send a one-time reset link.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {banner ? <Alert tone="error">{banner}</Alert> : null}

        <Field
          label="Email"
          name="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            if (fieldError) setFieldError(undefined);
          }}
          error={fieldError}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          spellCheck={false}
          autoFocus
          required
          disabled={pending}
          maxLength={254}
        />

        <Button type="submit" fullWidth size="lg" loading={pending} disabled={cooldown.active}>
          {cooldown.active ? `Try again in ${cooldown.remaining}s` : 'Send reset link'}
        </Button>
      </form>

      <div className="mt-5 border-t border-line-soft pt-4 text-xs">
        <Link href="/login" className="font-semibold text-neon hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

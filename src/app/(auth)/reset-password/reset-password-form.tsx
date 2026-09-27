'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui/primitives';
import { PasswordField } from '@/components/ui/form';
import { ApiRequestError, errorMessage } from '@/lib/api-client';
import { authApi } from '@/components/auth/auth-provider';
import { validateReset, type FormErrors } from '@/shared/form-validation';
import { PASSWORD_POLICY } from '@/shared/password-policy';
import { useCooldown } from '@/lib/use-cooldown';

/**
 * Set a new password from an emailed link.
 *
 * Two security-relevant behaviours:
 *  1. A successful reset revokes every existing session, so this page does *not*
 *     sign the player in. It sends them to `/login` with an explanatory message
 *     rather than silently granting a session the rest of the app would have to
 *     treat as suspicious.
 *  2. The token lives in component state, not in a ref or the URL after the
 *     first render, and it is cleared on success so a back-button revisit
 *     cannot replay it.
 */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const cooldown = useCooldown();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const values = useMemo(() => ({ password, confirmPassword }), [password, confirmPassword]);
  const live = useMemo(() => validateReset(values), [values]);

  const shownErrors: FormErrors = useMemo(() => {
    const out: FormErrors = { ...errors };
    if (touched.password && live.errors.password) out.password = live.errors.password;
    if (touched.confirmPassword && live.errors.confirmPassword) {
      out.confirmPassword = live.errors.confirmPassword;
    }
    return out;
  }, [live.errors, touched, errors]);

  if (!token) {
    return (
      <div className="panel px-6 py-7 sm:px-7">
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-rose/80">Link invalid</p>
        <h1 className="mt-2 text-lg">This reset link is not usable</h1>
        <div className="mt-4 space-y-4">
          <Alert tone="warning" title="The link is missing or malformed.">
            Reset links are single-use and expire after 60 minutes. Request a fresh one and open it
            from the same device.
          </Alert>
          <Link href="/forgot-password" className="inline-block text-xs font-semibold text-neon hover:underline">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="panel px-6 py-7 sm:px-7">
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">Password updated</p>
        <h1 className="mt-2 text-lg">You are ready to sign in</h1>
        <div className="mt-4 space-y-4">
          <Alert tone="success" title="Your new password is active.">
            For your security, every other device has been signed out. Sign in again with the
            password you just chose.
          </Alert>
          <Button variant="primary" size="lg" fullWidth onClick={() => router.push('/login?reset=1')}>
            Go to sign in
          </Button>
        </div>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown.active || !token) return;

    setTouched({ password: true, confirmPassword: true });
    setErrors({});
    if (!live.ok) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    setBanner(null);
    setPending(true);
    try {
      await authApi.resetPassword({ token, password, confirmPassword });
      setDone(true);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 429 && error.retryAfter) cooldown.start(error.retryAfter);
        // 401 here means the token is expired, already used, or for a different
        // endpoint. The server keeps those indistinguishable, so the copy does
        // not claim to know which it was.
        if (error.status === 401) {
          setBanner(
            'That reset link has expired or was already used. Request a new one to continue.',
          );
        }
        setErrors(error.fieldErrors);
      } else {
        setBanner(errorMessage(error));
      }
      setPending(false);
    }
  }

  return (
    <div className="panel px-6 py-7 sm:px-7">
      <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">Choose a new key</p>
      <h1 className="mt-2 text-lg">Set a new password</h1>
      <p className="mt-1.5 text-xs text-ink-dim">
        Signing out everywhere else is part of the reset, not a side effect.
      </p>

      <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {banner ? <Alert tone="error">{banner}</Alert> : null}

        <PasswordField
          label="New password"
          name="password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setTouched((t) => ({ ...t, password: true }));
          }}
          error={shownErrors.password}
          hint={`At least ${PASSWORD_POLICY.minLength} characters with upper, lower, digit and symbol.`}
          autoComplete="new-password"
          required
          disabled={pending}
          meter
          autoFocus
        />

        <PasswordField
          label="Confirm new password"
          name="confirmPassword"
          value={confirmPassword}
          onChange={(value) => {
            setConfirmPassword(value);
            setTouched((t) => ({ ...t, confirmPassword: true }));
          }}
          error={shownErrors.confirmPassword}
          autoComplete="new-password"
          required
          disabled={pending}
        />

        <Button type="submit" fullWidth size="lg" loading={pending} disabled={cooldown.active}>
          {cooldown.active
            ? `Try again in ${cooldown.remaining}s`
            : pending
              ? 'Updating'
              : 'Set new password'}
        </Button>
      </form>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button } from '@/components/ui/primitives';
import { Field, PasswordField } from '@/components/ui/form';
import { ApiRequestError, errorMessage } from '@/lib/api-client';
import { authApi, useAuth } from '@/components/auth/auth-provider';
import { validateLogin, type FormErrors } from '@/shared/form-validation';
import { sanitizeNextPath } from '@/lib/navigation';
import { useCooldown } from '@/lib/use-cooldown';
import { useRef } from 'react';

/**
 * Sign-in form.
 *
 * Error handling notes:
 *  - The server returns one generic message for a wrong password and for an
 *    unknown account, so this form never tries to guess which happened. It
 *    shows what it was given.
 *  - A 429 is rendered with its `Retry-After` as a countdown, because "too many
 *    attempts" without a time is the single most confusing auth failure.
 *  - The `next` path arrives already sanitised from the Server Component; the
 *    client re-validates on navigation so the guarantee does not depend on that.
 */
export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const formRef = useRef<HTMLFormElement>(null);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cooldown = useCooldown();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown.active) return;

    const validation = validateLogin({ identifier, password });
    setErrors(validation.errors);
    if (!validation.ok) {
      // Move focus to the first problem so a keyboard user is not stranded.
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    setBanner(null);
    setPending(true);
    try {
      await authApi.login({ identifier: identifier.trim(), password });
      await refresh();
      router.replace(sanitizeNextPath(nextPath));
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 429 && error.retryAfter) {
          cooldown.start(error.retryAfter);
        }
        setErrors(error.fieldErrors);
      }
      setBanner(errorMessage(error));
      setPending(false);
      // The password is cleared on failure: a retry should not resubmit a value
      // the server has already rejected, and it is not worth keeping in the DOM.
      setPassword('');
    }
  }

  return (
    <div className="panel scanlines relative overflow-hidden px-6 py-7 sm:px-7">
      <div className="relative">
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">Access terminal</p>
        <h1 className="mt-2 text-lg">Sign in</h1>
        <p className="mt-1.5 text-xs text-ink-dim">
          Use your callsign or the email address you registered with.
        </p>

        <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
          {banner ? <Alert tone="error">{banner}</Alert> : null}

          <Field
            label="Callsign or email"
            name="identifier"
            value={identifier}
            onChange={setIdentifier}
            error={errors.identifier}
            autoComplete="username"
            placeholder="netrunner"
            spellCheck={false}
            autoFocus
            required
            disabled={pending}
            maxLength={254}
          />

          <PasswordField
            label="Password"
            name="password"
            value={password}
            onChange={setPassword}
            error={errors.password}
            autoComplete="current-password"
            required
            disabled={pending}
          />

          <Button type="submit" fullWidth size="lg" loading={pending} disabled={cooldown.active}>
            {cooldown.active
              ? `Locked out for ${cooldown.remaining}s`
              : pending
                ? 'Authenticating'
                : 'Enter the grid'}
          </Button>
        </form>

        <div className="mt-5 flex flex-col gap-2 border-t border-line-soft pt-4 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-ink-faint">No account yet?</span>
            <Link href="/register" className="font-semibold text-neon hover:underline">
              Create a callsign
            </Link>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-faint">Forgot your password?</span>
            <Link href="/forgot-password" className="font-semibold text-neon hover:underline">
              Reset it
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

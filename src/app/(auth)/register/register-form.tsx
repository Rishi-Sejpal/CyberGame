'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button } from '@/components/ui/primitives';
import { Field, PasswordField } from '@/components/ui/form';
import { ApiRequestError, errorMessage } from '@/lib/api-client';
import { authApi } from '@/components/auth/auth-provider';
import { validateRegister, type FormErrors } from '@/shared/form-validation';
import { PASSWORD_POLICY } from '@/shared/password-policy';
import { USERNAME_MAX } from '@/shared/identity-rules';
import { useCooldown } from '@/lib/use-cooldown';

/**
 * Registration.
 *
 * The submit button is disabled until the form is locally valid, which is a UX
 * affordance, not a control: the server re-validates everything and its message
 * replaces whatever the client showed. Keeping the button enabled-but-invalid
 * would be worse, so the button instead shows *why* it is disabled via the field
 * errors, which appear as the player types.
 */
export function RegisterForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cooldown = useCooldown();

  const values = useMemo(
    () => ({ username, email, password, confirmPassword }),
    [username, email, password, confirmPassword],
  );

  const live = useMemo(
    () => validateRegister(values),
    // Re-validating on every keystroke is what makes the live meter honest.
    [values],
  );

  // Only surface a field error once the player has left that field, so the form
  // does not scold someone for a half-typed email address.
  const shownErrors: FormErrors = useMemo(() => {
    const out: FormErrors = {};
    for (const [key, message] of Object.entries(live.errors)) {
      if (touched[key]) out[key] = message;
    }
    // Server errors win: they are authoritative and may be about something the
    // local rules do not know, e.g. the callsign is already taken.
    return { ...out, ...errors };
  }, [live.errors, touched, errors]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown.active) return;

    setTouched({ username: true, email: true, password: true, confirmPassword: true });
    setErrors({});
    if (!live.ok) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    setBanner(null);
    setPending(true);
    try {
      await authApi.register({
        username: username.trim(),
        email: email.trim(),
        password,
        confirmPassword,
      });
      // Registration signs the player in, so hydrate before navigating.
      router.replace('/dashboard?welcome=1');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 429 && error.retryAfter) cooldown.start(error.retryAfter);
        setErrors(error.fieldErrors);
        if (error.code === 'conflict') {
          setBanner('That callsign or email is already taken. Try another, or sign in instead.');
        }
      } else {
        setBanner(errorMessage(error));
      }
      setPending(false);
    }
  }

  return (
    <div className="panel scanlines relative overflow-hidden px-6 py-7 sm:px-7">
      <div className="relative">
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">New operator</p>
        <h1 className="mt-2 text-lg">Create your callsign</h1>
        <p className="mt-1.5 text-xs text-ink-dim">
          Four fields. Your callsign is public on the leaderboard; your email never is.
        </p>

        <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
          {banner ? <Alert tone="error">{banner}</Alert> : null}

          <Field
            label="Callsign"
            name="username"
            value={username}
            onChange={(value) => {
              setUsername(value);
              setTouched((t) => ({ ...t, username: true }));
            }}
            error={shownErrors.username}
            hint="3-20 characters. Lowercase letters, digits, _ and -."
            autoComplete="username"
            placeholder="netrunner"
            spellCheck={false}
            autoFocus
            required
            disabled={pending}
            maxLength={USERNAME_MAX}
          />

          <Field
            label="Email"
            name="email"
            value={email}
            onChange={(value) => {
              setEmail(value);
              setTouched((t) => ({ ...t, email: true }));
            }}
            error={shownErrors.email}
            hint="Used for verification and password recovery. Never shown publicly."
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            spellCheck={false}
            required
            disabled={pending}
            maxLength={254}
          />

          <PasswordField
            label="Password"
            name="password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setTouched((t) => ({ ...t, password: true }));
            }}
            error={shownErrors.password}
            autoComplete="new-password"
            required
            disabled={pending}
            meter
            context={{ username, email }}
            hint={`At least ${PASSWORD_POLICY.minLength} characters with upper, lower, digit and symbol.`}
          />

          <PasswordField
            label="Confirm password"
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
              ? `Locked out for ${cooldown.remaining}s`
              : pending
                ? 'Provisioning'
                : 'Create account'}
          </Button>

          <p className="text-[0.6875rem] leading-relaxed text-ink-faint">
            By continuing you agree to learn responsibly. Every host, subnet and packet in this game
            is simulated — no traffic leaves your machine.
          </p>
        </form>

        <div className="mt-5 flex items-center justify-between border-t border-line-soft pt-4 text-xs">
          <span className="text-ink-faint">Already registered?</span>
          <Link href="/login" className="font-semibold text-neon hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

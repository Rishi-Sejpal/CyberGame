'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Panel, PanelHeader, Spinner } from '@/components/ui/primitives';
import { Field, PasswordField } from '@/components/ui/form';
import { ApiRequestError, errorMessage } from '@/lib/api-client';
import { authApi, useAuth } from '@/components/auth/auth-provider';
import { PASSWORD_POLICY } from '@/shared/password-policy';
import {
  validateChangePassword,
  validateProfile,
  type FormErrors,
} from '@/shared/form-validation';
import { useCooldown } from '@/lib/use-cooldown';
import { formatRelativeTime } from '@/lib/utils';
import type { AccountView, ProfileView, SessionInfoView } from '@/shared/account';

/**
 * Account settings.
 *
 * Three panels, each with its own independent save state. They are separate
 * components rather than one form with a shared "Save" button so a failure in
 * one cannot roll back or mask a success in another — the most confusing class
 * of settings-page bug.
 */
export function Settings({ user, profile }: { user: AccountView; profile: ProfileView | null }) {
  return (
    <div className="space-y-5">
      <header>
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">Configuration</p>
        <h1 className="mt-2 text-lg sm:text-xl">Settings</h1>
      </header>

      <ProfilePanel user={user} profile={profile} />
      <PasswordPanel user={user} />
      <div id="sessions">
        <SessionsPanel />
      </div>
      <DangerZonePanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfilePanel({ user, profile }: { user: AccountView; profile: ProfileView | null }) {
  const { refresh } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.handle ?? user.displayName);
  const [errors, setErrors] = useState<FormErrors>({});
  const [banner, setBanner] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const dirty = displayName.trim() !== (profile?.handle ?? user.displayName);

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const validation = validateProfile({ displayName });
    setErrors(validation.errors);
    if (!validation.ok) return;

    setPending(true);
    setBanner(null);
    try {
      await authApi.updateProfile({ displayName: displayName.trim() });
      await refresh();
      setBanner({ tone: 'success', text: 'Display name updated.' });
    } catch (error) {
      setErrors(error instanceof ApiRequestError ? error.fieldErrors : {});
      setBanner({ tone: 'error', text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Profile"
        description="Your callsign is permanent. Your display name is what other players see."
      />
      <form onSubmit={onSave} noValidate className="space-y-4 px-5 py-4">
        {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}

        <Field
          label="Callsign"
          name="username"
          value={user.username}
          onChange={() => {}}
          hint="Chosen at registration and cannot be changed."
          autoComplete="username"
          disabled
        />

        <Field
          label="Email"
          name="email"
          value={user.email || '—'}
          onChange={() => {}}
          type="email"
          hint={user.emailVerified ? 'Verified.' : 'Not verified yet — recovery is unavailable.'}
          disabled
        />

        <Field
          label="Display name"
          name="displayName"
          value={displayName}
          onChange={setDisplayName}
          error={errors.displayName}
          hint="Up to 32 characters."
          autoComplete="nickname"
          maxLength={32}
          required
          disabled={pending}
        />

        <Button type="submit" loading={pending} disabled={!dirty}>
          {dirty ? 'Save changes' : 'Saved'}
        </Button>
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function PasswordPanel({ user }: { user: AccountView }) {
  const router = useRouter();
  const cooldown = useCooldown();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [banner, setBanner] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const validation = validateChangePassword(
    { currentPassword, password, confirmPassword },
    { username: user.username, email: user.email },
  );

  const shown: FormErrors = { ...errors };
  if (touched.currentPassword && validation.errors.currentPassword) {
    shown.currentPassword = validation.errors.currentPassword;
  }
  if (touched.password && validation.errors.password) {
    shown.password = validation.errors.password;
  }
  if (touched.confirmPassword && validation.errors.confirmPassword) {
    shown.confirmPassword = validation.errors.confirmPassword;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown.active) return;

    setTouched({ currentPassword: true, password: true, confirmPassword: true });
    setErrors({});
    if (!validation.ok) return;

    setPending(true);
    setBanner(null);
    try {
      await authApi.changePassword({ currentPassword, password, confirmPassword });
      // A password change bumps `sessionEpoch`, which revokes every session
      // including this one. The user is already signed out by the time this
      // resolves, so the local state is cleared and the browser is sent to the
      // login page rather than left with a shell that 401s on every action.
      setCurrentPassword('');
      setPassword('');
      setConfirmPassword('');
      setBanner({ tone: 'info', text: 'Password changed. Taking you back to sign in…' });
      setTimeout(() => {
        router.replace('/login?password=changed');
        router.refresh();
      }, 1200);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 429 && error.retryAfter) cooldown.start(error.retryAfter);
        if (error.status === 401) {
          setBanner({
            tone: 'error',
            text: 'That current password is not right. Every other change was discarded.',
          });
          setErrors({ currentPassword: 'Incorrect password.' });
        }
        setErrors((prev) => ({ ...prev, ...error.fieldErrors }));
      } else {
        setBanner({ tone: 'error', text: errorMessage(error) });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Password"
        description="Changing your password signs out every device, including this one."
      />
      <form onSubmit={onSubmit} noValidate className="space-y-4 px-5 py-4">
        {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}

        <PasswordField
          label="Current password"
          name="currentPassword"
          value={currentPassword}
          onChange={(value) => {
            setCurrentPassword(value);
            setTouched((t) => ({ ...t, currentPassword: true }));
          }}
          error={shown.currentPassword}
          autoComplete="current-password"
          required
          disabled={pending}
        />

        <PasswordField
          label="New password"
          name="password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setTouched((t) => ({ ...t, password: true }));
          }}
          error={shown.password}
          hint={`At least ${PASSWORD_POLICY.minLength} characters with upper, lower, digit and symbol.`}
          autoComplete="new-password"
          required
          disabled={pending}
          meter
          context={{ username: user.username, email: user.email }}
        />

        <PasswordField
          label="Confirm new password"
          name="confirmPassword"
          value={confirmPassword}
          onChange={(value) => {
            setConfirmPassword(value);
            setTouched((t) => ({ ...t, confirmPassword: true }));
          }}
          error={shown.confirmPassword}
          autoComplete="new-password"
          required
          disabled={pending}
        />

        <Button type="submit" loading={pending} disabled={cooldown.active}>
          {cooldown.active ? `Try again in ${cooldown.remaining}s` : 'Change password'}
        </Button>
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function SessionsPanel() {
  const [sessions, setSessions] = useState<SessionInfoView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const router = useRouter();

  // Loaded on mount rather than server-rendered: the list changes on every
  // revocation, and a page refresh to see the result is a poor experience. The
  // ids are opaque and the endpoint is scoped to the caller, so there is nothing
  // here that a server render would protect.
  //
  // `useEffect`, not a `useState` initializer: an initializer that fires a request
  // runs during render, and React runs render twice in StrictMode — two requests,
  // and a `setState` from inside a render pass.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await authApi.listSessions();
        if (active) setSessions(data.sessions);
      } catch (err) {
        if (active) {
          setSessions([]);
          setError(errorMessage(err));
        }
      }
    })();
    return () => {
      // Ignore a response that arrives after the panel is gone, or after the
      // player navigated to /login mid-flight.
      active = false;
    };
  }, []);

  async function load() {
    try {
      const data = await authApi.listSessions();
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      setSessions([]);
      setError(errorMessage(err));
    }
  }

  async function revoke(session: SessionInfoView) {
    setBusyId(session.id);
    setBanner(null);
    try {
      await authApi.revokeSession(session.id);
      setBanner({
        tone: 'success',
        text: session.current ? 'This device was signed out.' : `Revoked ${session.label}.`,
      });
      if (session.current) {
        router.replace('/login');
        router.refresh();
        return;
      }
      await load();
    } catch (err) {
      setBanner({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function revokeAll() {
    setRevokingAll(true);
    setBanner(null);
    try {
      const data = await authApi.logoutAll();
      setBanner({ tone: 'info', text: `Signed out ${data.revoked} sessions, including this one.` });
      router.replace('/login');
      router.refresh();
    } catch (err) {
      setBanner({ tone: 'error', text: errorMessage(err) });
    } finally {
      setRevokingAll(false);
    }
  }

  const otherCount = (sessions ?? []).filter((session) => !session.current).length;

  return (
    <Panel>
      <PanelHeader
        title="Active devices"
        description="Every signed-in browser holds a session. Revoke anything you do not recognise."
        actions={
          otherCount > 0 ? (
            <Button variant="danger" size="sm" loading={revokingAll} onClick={revokeAll}>
              Sign out everywhere
            </Button>
          ) : null
        }
      />

      <div className="space-y-3 px-5 py-4">
        {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}

        {sessions === null ? (
          <div className="flex items-center gap-2 py-6 text-xs text-ink-faint">
            <Spinner /> Loading devices…
          </div>
        ) : error ? (
          <Alert tone="error">{error}</Alert>
        ) : sessions.length === 0 ? (
          <p className="py-4 text-xs text-ink-faint">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-xs font-semibold">
                    {session.label}
                    {session.current ? <span className="chip text-neon">this device</span> : null}
                  </p>
                  <p className="hud-text mt-1 truncate text-[0.6875rem] text-ink-faint">
                    {session.ip ?? 'unknown address'} · last seen {formatRelativeTime(session.lastSeenAt)} ·
                    expires {formatRelativeTime(session.expiresAt)}
                  </p>
                </div>
                <Button
                  variant={session.current ? 'danger' : 'ghost'}
                  size="sm"
                  loading={busyId === session.id}
                  onClick={() => void revoke(session)}
                >
                  {session.current ? 'Sign out' : 'Revoke'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

function DangerZonePanel() {
  const [confirmed, setConfirmed] = useState(false);
  const router = useRouter();

  return (
    <Panel>
      <PanelHeader
        title="Danger zone"
        description="Actions that end access across every device."
      />
      <div className="space-y-3 px-5 py-4">
        <label className="flex items-start gap-2.5 text-xs text-ink-dim">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 size-4 accent-rose"
          />
          <span>
            I understand that signing out everywhere ends every session, including this one.
          </span>
        </label>
        <Button
          variant="danger"
          disabled={!confirmed}
          onClick={() => {
            void authApi
              .logoutAll()
              .then(() => {
                router.replace('/login');
                router.refresh();
              })
              .catch(() => {
                setConfirmed(false);
              });
          }}
        >
          Sign out of all devices
        </Button>
      </div>
    </Panel>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api-client';
import { authApi, useAuth } from '@/components/auth/auth-provider';
import { useCooldown } from '@/lib/use-cooldown';

type Phase = 'verifying' | 'verified' | 'missing' | 'failed';

/**
 * Consumes an emailed verification token.
 *
 * The submission is triggered from an effect rather than a click, because the
 * player arrived here by clicking a link — a "click here to verify" button on
 * that page would be a pointless extra step and a second chance to fail.
 *
 * The effect is guarded by a `useRef` so a re-render (or React Strict Mode's
 * double-invoke in development) cannot consume a single-use token twice and
 * show a spurious failure.
 */
export function VerifyEmailForm({
  token,
  notice,
}: {
  token: string | null;
  notice: string | null;
}) {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const started = useRef(false);
  const cooldown = useCooldown();

  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'missing');
  const [message, setMessage] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    void (async () => {
      try {
        await authApi.verifyEmail(token);
        setPhase('verified');
        await refresh();
        router.refresh();
      } catch (error) {
        setPhase('failed');
        setMessage(errorMessage(error));
      }
    })();
  }, [token, refresh, router]);

  async function onResend() {
    if (cooldown.active) return;
    try {
      await authApi.resendVerification();
      setResent(true);
      cooldown.start(45);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  if (phase === 'verifying') {
    return (
      <div className="panel px-6 py-7 sm:px-7" aria-busy="true">
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">Verifying</p>
        <h1 className="mt-2 text-lg">Checking your link…</h1>
        <p className="mt-3 text-xs text-ink-dim">One moment while we confirm the token.</p>
      </div>
    );
  }

  if (phase === 'verified') {
    return (
      <div className="panel px-6 py-7 sm:px-7">
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">Confirmed</p>
        <h1 className="mt-2 text-lg">Email verified</h1>
        <div className="mt-4 space-y-4">
          <Alert tone="success" title="Your address is confirmed.">
            Recovery links and security alerts will now reach you. Nothing else about your account
            changed.
          </Alert>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => router.push(user ? '/dashboard' : '/login')}
          >
            {user ? 'Continue to the grid' : 'Sign in'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel px-6 py-7 sm:px-7">
      <p className="text-[0.625rem] uppercase tracking-[0.3em] text-amber/80">Not verified</p>
      <h1 className="mt-2 text-lg">
        {phase === 'missing' ? 'This link is not usable' : 'That link did not work'}
      </h1>

      <div className="mt-4 space-y-4">
        <Alert tone="warning" title={phase === 'missing' ? 'No token in the link.' : undefined}>
          {message ??
            'Verification links can only be used once and expire after 24 hours. A mail scanner may also have opened your link before you did, which consumes it — that is expected, and a new link fixes it.'}
        </Alert>

        {notice === 'required' ? (
          <Alert tone="info">
            Some features stay locked until your address is confirmed. You can play the free
            Networking missions in the meantime.
          </Alert>
        ) : null}

        {resent ? <Alert tone="success">A fresh link is on its way.</Alert> : null}

        <div className="flex flex-col gap-2">
          <Button variant="primary" onClick={onResend} disabled={cooldown.active} fullWidth>
            {cooldown.active ? `Send another in ${cooldown.remaining}s` : 'Send a new link'}
          </Button>
          <Link
            href={user ? '/dashboard' : '/login'}
            className="text-center text-xs font-semibold text-neon hover:underline"
          >
            {user ? 'Back to the grid' : 'Back to sign in'}
          </Link>
        </div>
      </div>
    </div>
  );
}

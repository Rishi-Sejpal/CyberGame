'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, configureApiClient, ApiRequestError } from '@/lib/api-client';
import type { ApiErrorCode } from '@/shared/api-error';
import {
  asTierId,
  normalizeStats,
  type AccountView,
  type ProfileView,
  type SessionInfoView,
} from '@/shared/account';

/**
 * Client-side account and progression state.
 *
 * This is a *cache*, not a source of authority. The server is authoritative for
 * every field in here; the provider exists so the header can show a level and a
 * streak without a round trip per component, and so a 401 from anywhere can
 * invalidate the whole thing at once.
 *
 * Note what is absent: password hashes, `sessionEpoch`, IP addresses, and any
 * notion of an authoritative XP value the client could write. `xp` here is
 * display-only; the progression service is the only writer.
 */

/**
 * The wire types are re-exported from `src/shared/account.ts` so a component
 * never declares its own version of "what a profile looks like". The aliases
 * below keep the historical names working for call sites that read better with
 * them.
 */
export type PublicUser = AccountView;
export type PublicProfile = ProfileView;
export type SessionInfo = SessionInfoView;
export type UserTier = ProfileView['tier'];

export interface SessionSnapshot {
  user: PublicUser | null;
  profile: PublicProfile | null;
  /** True until the initial `/api/auth/me` probe settles. */
  loading: boolean;
  /** Set when the probe failed for a reason other than "not signed in". */
  error: string | null;
}

export interface AuthContextValue extends SessionSnapshot {
  refresh: () => Promise<void>;
  /** Clears local state without calling the server (post-logout). */
  reset: () => void;
  isAuthenticated: boolean;
  needsEmailVerification: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

export function AuthProvider({
  csrfCookieName,
  children,
}: {
  csrfCookieName: string;
  children: React.ReactNode;
}) {
  // Configure before any child can issue a request.
  configureApiClient({ csrfCookieName });

  const [state, setState] = useState<SessionSnapshot>({
    user: null,
    profile: null,
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: PublicUser | null; profile: PublicProfile | null }>(
        '/api/auth/me',
      );
      setState({
        user: data.user,
        // Defensive: the API could one day omit a stat, and a component reading
        // `profile.stats.packetsInspected` should not have to guard for that.
        profile: data.profile ? { ...data.profile, stats: normalizeStats(data.profile.stats) } : null,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        // Not signed in. This is a normal state, not a failure to report.
        setState({ user: null, profile: null, loading: false, error: null });
        return;
      }
      setState({
        user: null,
        profile: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load your account.',
      });
    }
  }, []);

  useEffect(() => {
    // React 18/19 Strict Mode mounts effects twice in development; a cancelled
    // first run must not clobber the second run's result.
    let active = true;
    void (async () => {
      await refresh();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  const reset = useCallback(() => {
    setState({ user: null, profile: null, loading: false, error: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      refresh,
      reset,
      isAuthenticated: state.user !== null,
      needsEmailVerification: state.user !== null && !state.user.emailVerified,
    }),
    [state, refresh, reset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Typed endpoints used by the auth forms. Thin on purpose — no state here. */
export const authApi = {
  register: (body: { username: string; email: string; password: string; confirmPassword: string }) =>
    apiFetch<{ user: PublicUser }>('/api/auth/register', { method: 'POST', body }),

  login: (body: { identifier: string; password: string }) =>
    apiFetch<{ user: PublicUser }>('/api/auth/login', { method: 'POST', body }),

  logout: () => apiFetch<{ loggedOut: true }>('/api/auth/logout', { method: 'POST' }),

  logoutAll: () => apiFetch<{ revoked: number }>('/api/auth/logout-all', { method: 'POST' }),

  forgotPassword: (email: string) =>
    apiFetch<{ accepted: true }>('/api/auth/forgot-password', { method: 'POST', body: { email } }),

  resetPassword: (body: { token: string; password: string; confirmPassword: string }) =>
    apiFetch<{ reset: true }>('/api/auth/reset-password', { method: 'POST', body }),

  verifyEmail: (token: string) =>
    apiFetch<{ user: PublicUser }>('/api/auth/verify-email', { method: 'POST', body: { token } }),

  resendVerification: () =>
    apiFetch<{ sent: true }>('/api/auth/resend-verification', { method: 'POST' }),

  changePassword: (body: { currentPassword: string; password: string; confirmPassword: string }) =>
    apiFetch<{ changed: true }>('/api/auth/change-password', { method: 'POST', body }),

  listSessions: () => apiFetch<{ sessions: SessionInfo[] }>('/api/auth/sessions'),

  revokeSession: (id: string) =>
    apiFetch<{ revoked: boolean; current: boolean }>(`/api/auth/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  profile: () => apiFetch<{ user: PublicUser | null; profile: PublicProfile | null }>('/api/profile'),

  updateProfile: (body: { displayName?: string; avatarId?: string }) =>
    apiFetch<{ updated: boolean }>('/api/profile', { method: 'PATCH', body }),
} as const;

export { asTierId };
export type { ApiErrorCode };

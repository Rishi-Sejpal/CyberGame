import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { connectDb } from '@/server/db/connect';
import { ProfileModel } from '@/server/db/models/profile.model';
import { UserModel } from '@/server/db/models/user.model';
import { createCookieJar, cookieSourceFromStore } from '@/server/security/cookies';
import { ensureProfile, resolveSession } from '@/server/security/session';
import { csrfCookieName } from '@/server/security/csrf';
import { AuthProvider } from '@/components/auth/auth-provider';
import { AppShell } from '@/components/app/app-shell';
import { toPublicUser } from '@/server/auth/service';
import { PageErrorBoundary } from '@/components/ui/error-boundary';
import {
  asTierId,
  normalizeStats,
  toIso,
  type AccountView,
  type ProfileView,
} from '@/shared/account';

/**
 * Rendered per request, never prerendered.
 *
 * These pages read the CSRF cookie name, the session and `searchParams`, all of
 * which are per-visitor. Prerendering them would also evaluate `env()` at build
 * time, which turns a development `.env.local` into a build failure — the
 * configuration is a runtime concern here, not a build artifact.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Shell for every signed-in screen.
 *
 * The session is resolved **here**, on the server, and the result is passed down
 * as props. That is the point: a protected Server Component never renders in an
 * unauthenticated state, so there is no flash of private UI and no child that
 * has to defend against `session === null`.
 *
 * The middleware already redirects requests with no session cookie. That is a UX
 * and cost measure; this is the security boundary. A forged cookie gets past the
 * middleware and dies here.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, sessionExpiresAt } = await loadShellData();

  return (
    <AuthProvider csrfCookieName={csrfCookieName()}>
      <AppShell
        user={user.view}
        profile={profile}
        sessionExpiresAt={sessionExpiresAt}
        unverified={!user.view.emailVerified}
      >
        <PageErrorBoundary>{children}</PageErrorBoundary>
      </AppShell>
    </AuthProvider>
  );
}

/**
 * Resolves the session and projects the shell's data.
 *
 * Exported so pages in this group render against exactly the same data as the
 * layout, with one extra round trip avoided by Next's per-request cache.
 */
export async function loadShellData(): Promise<{
  user: { view: AccountView; sessionId: string; sessionFingerprint: string };
  profile: ProfileView | null;
  sessionExpiresAt: string;
}> {
  const store = await cookies();
  const jar = createCookieJar(cookieSourceFromStore(store));

  const session = await resolveSession(jar);
  if (!session) {
    // `next` is derived from our own pathname and never from user input, so
    // there is no open-redirect surface on this path.
    redirect('/login');
  }

  await connectDb();
  const [row, existingProfile] = await Promise.all([
    UserModel.findById(session.user.id).lean(),
    ProfileModel.findOne({ userId: session.user.id }).lean(),
  ]);

  // A profile is created at registration, but a row could predate the profile
  // collection. Self-heal rather than rendering a shell that throws on
  // `profile.level` forever.
  const profile =
    existingProfile ?? (await ensureProfile(session.user.id, session.user.displayName));

  const view: AccountView = row
    ? toPublicUser(row)
    : {
        id: session.user.id,
        username: session.user.username,
        displayName: session.user.displayName,
        // The session projection deliberately omits the email, so it is only
        // available when the user row could be read.
        email: '',
        role: session.user.role,
        status: 'active',
        emailVerified: session.user.emailVerified,
        createdAt: new Date(0).toISOString(),
        lastLoginAt: null,
      };

  return {
    user: {
      view,
      sessionId: session.sessionId,
      sessionFingerprint: session.user.sessionFingerprint,
    },
    profile: profile
      ? {
          handle: profile.handle,
          avatarId: profile.avatarId,
          xp: profile.xp,
          level: profile.level,
          xpIntoLevel: profile.xpIntoLevel,
          xpForNextLevel: profile.xpForNextLevel,
          tier: asTierId(profile.tier),
          streakDays: profile.streakDays,
          stats: normalizeStats(profile.stats),
        }
      : null,
    sessionExpiresAt: toIso(session.expiresAt) ?? new Date().toISOString(),
  };
}

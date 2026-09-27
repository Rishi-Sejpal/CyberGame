'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button, Chip } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api-client';
import {
  authApi,
  useAuth,
  type PublicProfile,
  type PublicUser,
} from '@/components/auth/auth-provider';
import { cn, formatRelativeTime } from '@/lib/utils';

/**
 * Navigation chrome for signed-in pages.
 *
 * Renders the server-resolved session immediately, so there is no empty header
 * while `AuthProvider` re-fetches `/api/auth/me`. `AppShell` passes the
 * authoritative values as props and the provider merely keeps them fresh after a
 * mutation, which avoids a visible "0 XP" flash on every navigation.
 */

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Planned but not yet built. Rendered disabled so the map is honest. */
  unavailable?: boolean;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '▣' },
  { href: '/missions', label: 'Missions', icon: '◈' },
  { href: '/game', label: 'Grid', icon: '⬡' },
  { href: '/progress', label: 'Progress', icon: '▤' },
  { href: '/achievements', label: 'Badges', icon: '✦' },
  { href: '/inventory', label: 'Inventory', icon: '▣' },
];

const TIER_TONE = {
  beginner: 'neon',
  basic: 'cyan',
  intermediate: 'amber',
  advanced: 'amber',
  expert: 'rose',
} as const;

export function AppShell({
  user,
  profile,
  sessionExpiresAt,
  unverified,
  children,
}: {
  user: PublicUser;
  profile: PublicProfile | null;
  sessionExpiresAt: string;
  unverified: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { reset } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Any navigation closes the menu, so it cannot hang open over new content.
  useEffect(() => setMenuOpen(false), [pathname]);

  // `Escape` closes it; a menu that only closes on an outside click is a trap
  // for keyboard users.
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await authApi.logout();
    } catch (error) {
      // A failed logout must not strand the player in a shell they cannot leave,
      // so the failure is surfaced and the redirect is skipped rather than
      // pretended.
      setSigningOut(false);
      setMenuOpen(false);
      window.alert(errorMessage(error));
      return;
    }
    reset();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-abyss/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-2 text-xs uppercase tracking-[0.24em] text-neon/90 hover:text-neon"
          >
            <span aria-hidden="true" className="text-glow">
              ◈
            </span>
            <span className="hidden sm:inline">CYBERGRID</span>
          </Link>

          <nav
            aria-label="Primary"
            className="no-scrollbar ml-2 flex flex-1 items-center gap-1 overflow-x-auto"
          >
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.unavailable ? '#' : item.href}
                  aria-current={active ? 'page' : undefined}
                  aria-disabled={item.unavailable || undefined}
                  tabIndex={item.unavailable ? -1 : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                    item.unavailable && 'cursor-not-allowed opacity-40',
                    active
                      ? 'bg-neon/10 font-semibold text-neon'
                      : 'text-ink-dim hover:bg-white/5 hover:text-ink',
                  )}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {profile ? (
            <Link
              href="/progress"
              className="hidden shrink-0 items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-neon-dim md:flex"
            >
              <Chip tone="neon">LV {profile.level}</Chip>
              <span className="hud-text text-ink-dim">{profile.xp} XP</span>
            </Link>
          ) : null}

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors hover:border-neon-dim"
            >
              <span
                aria-hidden="true"
                className="flex size-5 items-center justify-center rounded bg-violet/20 text-[0.625rem] font-bold text-violet"
              >
                {user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-24 truncate sm:inline">{user.displayName}</span>
              <span aria-hidden="true" className="text-ink-faint">
                ▾
              </span>
              <span className="sr-only">Account menu</span>
            </button>

            {menuOpen ? (
              <div
                role="menu"
                aria-label="Account"
                className="panel absolute right-0 z-50 mt-2 w-60 overflow-hidden p-1 text-sm"
              >
                <div className="border-b border-line-soft px-3 py-2.5">
                  <p className="truncate text-xs font-semibold">{user.displayName}</p>
                  <p className="truncate text-[0.6875rem] text-ink-faint">@{user.username}</p>
                  {profile ? (
                    <div className="mt-2 flex items-center gap-1.5">
                      <Chip tone={TIER_TONE[profile.tier] ?? 'neutral'}>{profile.tier}</Chip>
                      {profile.streakDays > 0 ? (
                        <span className="hud-text text-[0.6875rem] text-amber">
                          {profile.streakDays}d streak
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <Link
                  role="menuitem"
                  href="/profile"
                  className="block px-3 py-2 text-xs hover:bg-white/5"
                >
                  Profile
                </Link>
                <Link
                  role="menuitem"
                  href="/settings"
                  className="block px-3 py-2 text-xs hover:bg-white/5"
                >
                  Settings
                </Link>
                <Link
                  role="menuitem"
                  href="/settings#sessions"
                  className="block px-3 py-2 text-xs hover:bg-white/5"
                >
                  Active devices
                </Link>

                <div className="mt-1 border-t border-line-soft px-3 py-2">
                  <p className="text-[0.625rem] text-ink-faint">
                    Session expires {formatRelativeTime(sessionExpiresAt)}
                  </p>
                </div>

                <div className="p-1">
                  <Button
                    variant="danger"
                    size="sm"
                    fullWidth
                    loading={signingOut}
                    onClick={onSignOut}
                  >
                    Sign out
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {unverified ? <UnverifiedBanner /> : null}

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="border-t border-line/60 px-4 py-4 text-center text-[0.6875rem] text-ink-faint sm:px-6">
        <p>
          CYBERGRID training environment. No traffic leaves your device. ·{' '}
          <Link href="/settings" className="text-neon-dim hover:text-neon">
            Settings
          </Link>
        </p>
      </footer>
    </div>
  );
}

/**
 * Unverified accounts keep full access to the free Networking campaign; this
 * explains the restriction instead of leaving the player to wonder why a button
 * is disabled.
 */
function UnverifiedBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="border-b border-amber/25 bg-amber/8">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 text-xs sm:px-6">
        <span aria-hidden="true" className="text-amber">
          ⚠
        </span>
        <p className="min-w-0 flex-1 text-amber/90">
          Your email is not confirmed, so password recovery and security alerts are unavailable.{' '}
          <Link href="/verify-email" className="font-semibold underline">
            Confirm it now
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-amber/60 hover:text-amber"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

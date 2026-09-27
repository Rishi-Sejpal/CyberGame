import Link from 'next/link';
import { AuthProvider } from '@/components/auth/auth-provider';
import { csrfCookieName } from '@/server/security/csrf';

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
 * Shell for every unauthenticated screen.
 *
 * Two jobs:
 *  1. Give the Client Components the CSRF cookie name. The client cannot import
 *     `@/server/config/env` (it is `server-only`), and hard-coding the name in
 *     two places is how a renamed cookie silently breaks every form. Passing it
 *     down from a Server Component keeps one definition.
 *  2. Frame the form in a small viewport-first panel. The app shell lives in
 *     `(app)` and is deliberately not nested here — a signed-out visitor should
 *     not pay for the navigation they cannot use.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider csrfCookieName={csrfCookieName()}>
      <div className="grid-noise relative flex min-h-dvh flex-col">
        <header className="border-b border-line/60 px-5 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-neon/80 transition-colors hover:text-neon"
          >
            <span aria-hidden="true" className="text-glow">
              ◈
            </span>
            CYBERGRID
          </Link>
        </header>

        <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
          <div className="w-full max-w-md">{children}</div>
        </main>

        <footer className="px-5 py-5 text-center text-[0.6875rem] text-ink-faint">
          <p>Training environment. All traffic is simulated.</p>
        </footer>
      </div>
    </AuthProvider>
  );
}

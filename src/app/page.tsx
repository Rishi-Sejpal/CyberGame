import Link from 'next/link';
import { cookies } from 'next/headers';
import { createCookieJar, cookieSourceFromHeader } from '@/server/security/cookies';
import { resolveSession } from '@/server/security/session';
import { MODULES_PLANNED_NOTE } from './landing-links';

export const dynamic = 'force-dynamic';

/**
 * Marketing landing page.
 *
 * A Server Component that resolves the session once, server-side, purely to pick
 * the right call to action ("Enter the grid" vs "Create a callsign"). It renders
 * identical markup either way — no `useEffect` flash from "Sign in" to
 * "Dashboard" — which is the whole reason this is not a Client Component.
 */
export default async function LandingPage() {
  const store = await cookies();
  const jar = createCookieJar(cookieSourceFromHeader(store.get('cookie')?.toString() ?? null));
  const session = await resolveSession(jar);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-neon focus:px-4 focus:py-2 focus:text-abyss"
      >
        Skip to content
      </a>

      <header className="border-b border-line/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-neon/90">
            <span aria-hidden="true" className="text-glow">
              ◈
            </span>
            CYBERGRID
          </p>
          <nav aria-label="Account" className="flex items-center gap-2">
            {session ? (
              <Link href="/dashboard" className="btn btn-primary px-4 py-2 text-xs">
                Enter the grid
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost px-4 py-2 text-xs">
                  Sign in
                </Link>
                <Link href="/register" className="btn btn-primary px-4 py-2 text-xs">
                  Start free
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        <section className="grid-noise relative overflow-hidden border-b border-line/60">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <p className="text-[0.625rem] uppercase tracking-[0.32em] text-neon/70">
              A cybersecurity academy, played
            </p>
            <h1 className="mt-4 max-w-3xl text-2xl leading-tight sm:text-4xl">
              Walk the grid. Learn to read a network like a map.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-ink-dim">
              A 2D pixel world where routers are buildings, packets have destinations, and every
              firewall rule you get wrong shows up as a light that will not turn green. Eight levels
              of Networking, playable end to end, with answers checked on the server.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={session ? '/dashboard' : '/register'} className="btn btn-primary px-6 py-3">
                {session ? 'Continue training' : 'Create a free callsign'}
              </Link>
              <Link href="#curriculum" className="btn btn-ghost px-6 py-3">
                See what you learn
              </Link>
            </div>

            <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { term: '8', detail: 'Networking levels' },
                { term: '100%', detail: 'simulated traffic' },
                { term: 'Server', detail: 'checked answers' },
                { term: '0', detail: 'real packets sent' },
              ].map((item) => (
                <div key={item.detail} className="panel-inset px-3.5 py-3">
                  <dt className="hud-text text-base text-neon">{item.term}</dt>
                  <dd className="mt-1 text-[0.6875rem] leading-snug text-ink-faint">{item.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="curriculum" className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <h2 className="text-lg">The Networking campaign</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-dim">
            Each level is a place you explore, not a form you fill in. The concept is introduced in
            the world, then tested on real configurations.
          </p>

          <ol className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              {
                n: '01',
                title: 'First contact',
                body: 'Identify hosts, read a MAC table, and learn what a broadcast domain actually is.',
              },
              {
                n: '02',
                title: 'The local network',
                body: 'VLANs, trunk ports and why two devices that are "on the same switch" may not talk.',
              },
              {
                n: '03',
                title: 'Subnets and masks',
                body: 'Split a network so the right devices share a segment. The level where most people finally get CIDR.',
              },
              {
                n: '04',
                title: 'Routing tables',
                body: 'Read a routing table line by line and predict where a packet goes next.',
              },
              {
                n: '05',
                title: 'Packet analysis',
                body: 'Open a capture, follow one conversation, and spot the frame that does not belong.',
              },
              {
                n: '06',
                title: 'Firewalls and NAT',
                body: 'Write rules that permit what should be permitted and nothing else.',
              },
              {
                n: '07',
                title: 'DNS and services',
                body: 'Resolve names, trace a lookup, and separate a DNS problem from a routing one.',
              },
              {
                n: '08',
                title: 'Grid defence',
                body: 'An incident is unfolding. You get symptoms, not answers.',
              },
            ].map((level) => (
              <li key={level.n} className="panel px-5 py-4">
                <p className="hud-text text-xs text-neon/70">{level.n}</p>
                <h3 className="mt-2 text-sm">{level.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{level.body}</p>
              </li>
            ))}
          </ol>

          <div className="panel mt-8 px-5 py-5">
            <h3 className="text-sm">And four more modules after that</h3>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-dim">
              Web security, applied cryptography, digital forensics and network defence are designed
              and in production — {MODULES_PLANNED_NOTE}. They will follow the same contract:
              playable level, server-verified answers, and progression the browser cannot forge.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['Web', 'Crypto', 'Forensics', 'Defence'].map((module) => (
                <span key={module} className="chip text-ink-faint">
                  {module} · planned
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line/60">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
            <h2 className="text-lg">Built like it matters, because it does</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                {
                  t: 'Your password never sits in a database',
                  b: 'Argon2id, always. The stored hash is additionally keyed with a secret that lives outside the database, so a dump alone is not enough to attack offline.',
                },
                {
                  t: 'Sessions you can see and cut off',
                  b: 'Every signed-in browser is listed in settings with its address and last-seen time. Revoke any of them in one click.',
                },
                {
                  t: 'Progress only the server can award',
                  b: 'XP, levels, unlocks and completions are written by the server when a mission is verified. The browser has no field to submit them in.',
                },
              ].map((item) => (
                <div key={item.t} className="panel-inset px-4 py-4">
                  <h3 className="text-xs">{item.t}</h3>
                  <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-faint">{item.b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/60 px-5 py-6 text-center text-[0.6875rem] text-ink-faint sm:px-8">
        <p>
          CYBERGRID is a training environment. Every host, subnet and packet is simulated inside your
          browser.
        </p>
      </footer>
    </div>
  );
}

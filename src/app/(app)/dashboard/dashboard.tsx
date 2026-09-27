import Link from 'next/link';
import {
  Chip,
  EmptyState,
  Panel,
  PanelHeader,
  ProgressBar,
  Stat,
} from '@/components/ui/primitives';
import { TIER_META, xpToAdvance } from '@/game/types/progression';
import { formatDuration, formatNumber } from '@/lib/utils';
import type { AccountView, ProfileView } from '@/shared/account';

/**
 * Dashboard.
 *
 * A Server Component: it renders straight from the projection the layout already
 * fetched, so there is no loading spinner and no client-side waterfall. Every
 * number here is read-only — the dashboard has no mutation endpoint, which is the
 * cheapest possible guarantee that a player cannot award themselves XP.
 */
export function Dashboard({ user, profile }: { user: AccountView; profile: ProfileView | null }) {
  const xp = profile?.xp ?? 0;
  const level = profile?.level ?? 1;
  const intoLevel = profile?.xpIntoLevel ?? 0;
  const needed = profile?.xpForNextLevel ?? xpToAdvance(level);
  const tier = TIER_META[profile?.tier ?? 'beginner'];
  const stats = profile?.stats;

  const firstRun = !stats || stats.missionsCompleted === 0;

  return (
    <div className="space-y-6">
      <header className="animate-fade-up">
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-neon/70">Operator status</p>
        <h1 className="mt-2 text-lg sm:text-xl">Welcome back, {user.displayName}</h1>
        <p className="mt-1 text-xs text-ink-dim">
          {user.emailVerified
            ? 'Account verified. Everything is unlocked up to your current tier.'
            : 'Email unconfirmed — the free Networking campaign is available, recovery is not.'}
        </p>
      </header>

      <section aria-label="Progression" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Level" value={level} hint={tier.label} tone="neon" />
        <Stat
          label="Total XP"
          value={formatNumber(xp)}
          hint={`${formatNumber(intoLevel)} / ${formatNumber(needed)} to next`}
        />
        <Stat
          label="Streak"
          value={`${profile?.streakDays ?? 0}d`}
          hint={(profile?.streakDays ?? 0) > 0 ? 'Keep it alive' : 'Complete a mission today'}
          tone={profile?.streakDays ? 'amber' : 'neutral'}
        />
        <Stat
          label="Missions"
          value={stats?.missionsCompleted ?? 0}
          hint={`${stats?.challengesSolved ?? 0} challenges solved`}
        />
      </section>

      <Panel>
        <PanelHeader
          title="Next milestone"
          description={`Level ${level + 1} unlocks at ${formatNumber(needed)} XP into this level.`}
          actions={<Chip tone="neon">{tier.label}</Chip>}
        />
        <div className="px-5 py-4">
          <ProgressBar value={intoLevel} max={needed} label={`Progress to level ${level + 1}`} />
          <p className="mt-2 text-xs text-ink-dim">
            {firstRun
              ? 'Finish your first mission to start earning XP.'
              : `${formatNumber(Math.max(0, needed - intoLevel))} XP to go.`}
          </p>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Networking campaign"
            description="Eight levels, fully playable. Everything else is in development."
            actions={
              <Link href="/missions" className="btn btn-ghost px-3 py-1.5 text-xs">
                Browse
              </Link>
            }
          />
          <div className="px-5 py-4">
            <ol className="space-y-2">
              {[
                {
                  id: 'networking.l1',
                  name: 'First contact',
                  done: (stats?.levelsCompleted ?? 0) >= 1,
                },
                {
                  id: 'networking.l2',
                  name: 'The local network',
                  done: (stats?.levelsCompleted ?? 0) >= 2,
                },
                {
                  id: 'networking.l3',
                  name: 'Subnets and masks',
                  done: (stats?.levelsCompleted ?? 0) >= 3,
                },
                {
                  id: 'networking.l4',
                  name: 'Routing tables',
                  done: (stats?.levelsCompleted ?? 0) >= 4,
                },
                {
                  id: 'networking.l5',
                  name: 'Packet analysis',
                  done: (stats?.levelsCompleted ?? 0) >= 5,
                },
                {
                  id: 'networking.l6',
                  name: 'Firewalls and NAT',
                  done: (stats?.levelsCompleted ?? 0) >= 6,
                },
                {
                  id: 'networking.l7',
                  name: 'DNS and services',
                  done: (stats?.levelsCompleted ?? 0) >= 7,
                },
                {
                  id: 'networking.l8',
                  name: 'Grid defence',
                  done: (stats?.levelsCompleted ?? 0) >= 8,
                },
              ].map((levelItem, index) => (
                <li
                  key={levelItem.id}
                  className="flex items-center gap-3 rounded-md border border-line-soft px-3 py-2"
                >
                  <span
                    aria-hidden="true"
                    className={
                      levelItem.done
                        ? 'flex size-5 shrink-0 items-center justify-center rounded bg-neon/15 text-[0.625rem] text-neon'
                        : 'hud-text flex size-5 shrink-0 items-center justify-center rounded bg-abyss text-[0.625rem] text-ink-faint'
                    }
                  >
                    {levelItem.done ? '✓' : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs">{levelItem.name}</span>
                  {levelItem.done ? <Chip tone="neon">done</Chip> : null}
                </li>
              ))}
            </ol>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Your record" />
            <div className="grid grid-cols-2 gap-3 px-5 py-4">
              <Stat
                label="Challenges"
                value={stats?.challengesSolved ?? 0}
                hint={`${stats?.totalAttempts ?? 0} attempts`}
              />
              <Stat
                label="Perfect runs"
                value={stats?.perfectMissions ?? 0}
                hint={
                  stats?.fastestMissionMs
                    ? `Best ${formatDuration(stats.fastestMissionMs)}`
                    : 'No time yet'
                }
              />
              <Stat
                label="Packets read"
                value={stats?.packetsInspected ?? 0}
                hint={`${stats?.packetsFlagged ?? 0} flagged`}
              />
              <Stat
                label="Play time"
                value={formatDuration(stats?.playTimeMs ?? 0)}
                hint={`${stats?.totalHintsUsed ?? 0} hints used`}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="In development" description="Planned modules, not yet playable." />
            <div className="px-5 py-4">
              <EmptyState
                title="Web, crypto, forensics and defence"
                description="Each module follows the same contract as Networking: a playable level, server-checked answers, and XP that only the server can award."
                action={
                  <Link href="/modules" className="btn btn-ghost px-3 py-1.5 text-xs">
                    See the roadmap
                  </Link>
                }
              />
            </div>
          </Panel>
        </div>
      </div>

      <p className="text-center text-[0.6875rem] text-ink-faint">
        Progress shown here is read-only. XP, unlocks and completions are awarded by the server when
        a mission is verified — the browser cannot change them.
      </p>
    </div>
  );
}

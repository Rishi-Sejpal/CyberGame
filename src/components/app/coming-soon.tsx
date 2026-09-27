import type { Metadata } from 'next';
import { Chip, EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';

/**
 * Placeholder registry.
 *
 * The navigation advertises six areas and only two exist. Rendering an honest
 * "not built yet" page is better than a dead link: it tells a player exactly
 * where the roadmap stands instead of leaving them wondering whether they broke
 * something. Each entry is removed from this map as the real page lands, so the
 * placeholder can never outlive its replacement.
 */
export const PLANNED_ROUTES = {
  '/missions': {
    title: 'Missions',
    summary: 'The mission board: one entry point per mission, with prerequisites and rewards shown up front.',
    depends: 'Content catalogue seeding and the mission-start endpoint.',
  },
  '/game': {
    title: 'The Grid',
    summary: 'The Phaser world. Walk between routers, patch panels and terminals; challenges open in place.',
    depends: 'The tile renderer, camera, and the world save API.',
  },
  '/progress': {
    title: 'Progress',
    summary: 'Per-module and per-level breakdown, XP history and mastery state.',
    depends: 'The progression history endpoint.',
  },
  '/achievements': {
    title: 'Badges',
    summary: 'Every achievement with its unlock condition, so nothing is a mystery.',
    depends: 'Achievement evaluation, which fires on mission completion.',
  },
  '/inventory': {
    title: 'Inventory',
    summary: 'Cosmetics, avatar parts and collected lore. Nothing here affects difficulty.',
    depends: 'The inventory grant path and an asset pass.',
  },
  '/modules': {
    title: 'Modules',
    summary: 'The full curriculum map, including the four modules still in design.',
    depends: 'Content definitions for Web, Crypto, Forensics and Defence.',
  },
  '/profile': {
    title: 'Profile',
    summary: 'Public profile and leaderboard placement.',
    depends: 'The leaderboard endpoint.',
  },
} as const;

export type PlannedRoute = keyof typeof PLANNED_ROUTES;

/**
 * Renders a not-built page. Shared by every placeholder route so they all read
 * the same and none of them accidentally looks finished.
 */
export function ComingSoon({ route }: { route: PlannedRoute }) {
  const entry = PLANNED_ROUTES[route];
  return (
    <div className="space-y-5">
      <header>
        <p className="text-[0.625rem] uppercase tracking-[0.3em] text-amber/70">In development</p>
        <h1 className="mt-2 text-lg sm:text-xl">{entry.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-ink-dim">{entry.summary}</p>
      </header>

      <Panel>
        <PanelHeader title="Status" description="This page is a deliberate placeholder, not a bug." />
        <div className="px-5 py-4">
          <EmptyState title="Nothing here yet" description={entry.depends} action={<Chip tone="amber">Planned</Chip>} />
        </div>
      </Panel>
    </div>
  );
}

export const COMING_SOON_METADATA: Metadata = {
  robots: { index: false, follow: false },
};

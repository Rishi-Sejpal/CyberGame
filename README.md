# CYBERGRID

A cybersecurity academy you play as a 2D pixel world. Routers are buildings,
packets have destinations, and a firewall rule you get wrong shows up as a light
that will not turn green.

Every host, subnet and packet is simulated. Nothing leaves the browser except a
challenge answer, and every answer, XP award and unlock is decided on the server.

## Status

Working end to end: registration, email verification, sign-in, password recovery,
session management, the protected shell, the dashboard, settings, and a landing
page. 136 tests, no UI tests yet.

Not built yet, and shown in the app as honest placeholders rather than dead
links: the Phaser world, missions, challenges, the progression history, badges,
inventory, the module map, and the campaign content itself.

The Networking campaign is Levels 1–8. Four further modules (Web, Crypto,
Forensics, Defence) are designed and not yet written.

## Requirements

- Node.js 22 or newer
- MongoDB 7 or newer, local or remote

```bash
npm install
cp .env.example .env.local     # then edit the two secrets
npm run db:dev                 # local mongod on 27018, in another terminal
npm run dev                    # http://localhost:3000
```

Generate the two secrets the template asks for:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The application refuses to boot on a missing or weak secret, an `APP_URL` that is
not https in production, or a development-only flag left enabled in production.
That refusal is intentional — see [docs/SECURITY.md](docs/SECURITY.md).

### If you cannot run MongoDB locally

Point `MONGODB_URI` at any reachable instance and skip `npm run db:dev`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` / `npm run typecheck` | ESLint, `tsc --noEmit` |
| `npm test` | Vitest, with a throwaway MongoDB on its own port |
| `npm run test:watch`, `npm run test:coverage` | As above, interactive / instrumented |
| `npm run verify` | `lint` + `typecheck` + `test` — run this before pushing |
| `npm run format` / `format:check` | Prettier |
| `npm run db:dev` / `db:stop` / `db:status` | Local MongoDB, foreground / stop / status |

Every script invokes its tool through Node directly. This repository lives on a
filesystem that cannot create symlinks, so `npm install` must be run with
`--no-bin-links` and there is no `node_modules/.bin`.

## How it is put together

```
src/
  app/            routes only — thin handlers and server components
  components/     React components; ui/ is generic, auth/ and app/ are feature shells
  game/           pure game maths and content contracts, no I/O
  lib/            browser-only helpers: api client, navigation, cooldowns
  server/         everything that touches the database, secrets or the network
  shared/         imported by BOTH sides, so a rule cannot drift
```

Two rules hold the design together:

1. **The server is the only writer of anything that matters.** The browser has no
   field to submit XP, levels, completions or rewards in, so a crafted request is
   rejected by validation rather than by a check someone might forget.
2. **Anything both sides must agree on lives in `src/shared/`** — the password
   policy, identity rules, the API error envelope, and the wire types. A rule
   cannot be tightened on the server while a form keeps advertising the old one.

Protected pages resolve the session in a Server Component and pass the result
down as props, so a private screen never renders in an unauthenticated state and
there is no flash of signed-out UI.

## Testing

`npm test` boots its own MongoDB, so it never touches your development data. The
suite covers the security-critical behaviour — authentication, session
revocation, CSRF, IDOR resistance, password policy, the redirect sanitiser, the
API client, and the error envelope.

There is no React Testing Library yet. Logic that is worth testing is therefore
kept in pure modules in `src/shared/` and `src/lib/`, and components stay thin.

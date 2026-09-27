# Security model

What this application defends against, how, and where the code lives. If you are
reviewing a change, this is the list of things a pull request is not allowed to
weaken silently.

The short version: **the browser is treated as hostile, the database is treated
as eventually compromised, and the server is the only writer of anything that
matters.**

---

## 1. Passwords

| Property | Implementation |
| --- | --- |
| Hash | Argon2id only, `argon2i` is never used |
| Cost | `ARGON2_MEMORY_COST` / `TIME_COST` / `PARALLELISM` in `src/server/config/env.ts` |
| Salt | Per-password, from the CSPRNG |
| Pepper | `PASSWORD_PEPPER`, mixed into the hash input, **never stored** |
| Comparison | Constant-time, via `timingSafeEqual` |
| Policy | `src/shared/password-policy.ts`, shared by the form and the API |

Two things are deliberate and worth preserving:

- **The pepper is not in the database.** A stolen dump therefore does not yield
  hashes that can be attacked offline at all. Rotate it and every password
  becomes invalid, so it lives in the deployment secret store.
- **The policy is one module, imported by both sides.** The server result is
  authoritative; the client copy exists so a player is not told "too short" after
  pressing submit. Tightening the server without the client can never diverge
  into a form that advertises a rule the API rejects.

A dummy hash is computed for unknown accounts so a missing user and a wrong
password take the same time. That is the point of
`src/server/auth/service.ts` `dummyHash()` — do not "optimise" it away.

## 2. Sessions

- The cookie carries a random 256-bit token. Only its SHA-256 digest is stored,
  so a database dump cannot be replayed as a live session.
- The session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` whenever `APP_URL`
  is https, and scoped to `Path=/`.
- Sessions are listed to their owner in **Settings → Active devices**, with the
  address and last-seen time, and can be revoked individually or all at once.
- A password change and a "sign out everywhere" bump `sessionEpoch`, which
  invalidates every outstanding session including ones whose token is still
  unknown to the attacker.
- Revoking by id filters on `{ _id, userId }`. An id belonging to somebody else
  and an id that does not exist both answer **404** — the same status, body and
  timing — so the endpoint is not an ID oracle. See
  `src/app/api/auth/sessions/[id]/route.ts`.

## 3. CSRF

Double-submit, with the cookie deliberately readable by JavaScript:

- The edge (`src/middleware.ts`) issues the CSRF cookie on the first page view
  using Web Crypto, so a visitor with no session can submit the login form. A
  Server Component cannot set cookies, and a Server Action would cost an extra
  round trip per page view.
- Every mutating request must echo the cookie value in `x-csrf-token`
  (`src/lib/api-client.ts` for the browser, `src/server/security/csrf.ts` for the
  server).
- Requests are additionally checked against `Origin`/`ALLOWED_ORIGINS`.
- A rejected write answers `csrf_rejected` / 403 and never reaches a handler.

## 4. Progression and rewards

The browser has **no field to submit XP, levels, completions, unlocks, rewards,
inventory or achievements in.** The schemas do not accept them, so a crafted
request is rejected by validation rather than by a check someone might forget.

Level curves live in `src/game/types/progression.ts` as pure functions, used by
the client to render a progress bar and by the server to recompute the same
value. They agree by construction because there is one implementation.

Challenge solutions are server-side only. Content documents sent to the browser
are projections, not the stored record.

## 5. Transport and headers

Set in `next.config.ts`:

- Content-Security-Policy, with no `unsafe-eval` in production
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
- Clickjacking: `X-Frame-Options: DENY` and `frame-ancestors 'none'`
- `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security` outside development, where TLS is terminated
- `Permissions-Policy` denying camera, microphone, geolocation, payment and USB

## 6. Input handling

- Every request body passes a Zod schema in `src/server/validation/schemas.ts`.
  Routes without a schema are a review failure, not an oversight.
- Identifiers are opaque; no route accepts a user id to act on. Identity comes
  from the resolved session.
- Errors are a fixed taxonomy (`src/server/http/errors.ts`). Anything outside it
  becomes a generic 500 with a correlation id. **Internal messages, stack traces
  and driver errors never reach the client**; `details` is only populated when an
  endpoint has explicitly decided the caller may see it.
- Every response carries a `requestId` that also lands in the audit log, so a
  user-reported failure is correlatable.

## 7. Abuse limits

- Rate limits per rule (`RATE_RULES`), keyed on the most specific thing available:
  account, then address, then a global bucket.
- Failed logins are counted per account; the account locks and the response is
  identical to a wrong password, so the lock is not a username oracle.
- Verification and reset tokens are single-use, expire, and are stored hashed.
  Verification is submitted by POST from our own page, so a mail-scanner that
  follows links cannot consume the token before the user does.
- `AUTH_TEST_FAST_HASH` and `DEV_MAIL_PREVIEW` are refused when
  `NODE_ENV=production`. The configuration refuses to boot rather than warning.

## 8. Audit trail

Security-relevant actions append to a hash-chained log
(`src/server/security/audit.ts`): sign-in, sign-out, revocation, password change,
password reset, email verification, and every rate-limit rejection. The chain
makes a deleted entry detectable.

---

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue.

## When you change something here

- A pull request that touches `src/server/security/`, `src/shared/password-policy.ts`
  or `src/shared/identity-rules.ts` needs a test that fails without the change.
- Do not weaken a check to make a test pass. If a check is wrong, say so in the
  pull request and fix both.
- `docs/SECURITY.md` is part of the change: if a mechanism moves, this file moves
  with it.

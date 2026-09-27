import 'server-only';

/**
 * Fixed-window rate limiter with a token-bucket burst allowance.
 *
 * Deployment note
 * ----------------
 * This is an in-process limiter. It is correct for a single Node process and is
 * the right default because it has zero infrastructure cost. When the app is
 * scaled horizontally, swap the store for Redis — `RateLimiter` takes a store
 * interface precisely so that is a ~30 line change, not a rewrite.
 *
 * What it defends against
 * -----------------------
 *  - credential stuffing / brute force (per account *and* per IP)
 *  - enumeration (uniform response shape and uniform timing budget)
 *  - resource exhaustion on expensive endpoints (mission submission, search)
 *
 * Memory is bounded: buckets are swept on a timer and the map refuses to grow
 * past `maxKeys`, after which the oldest buckets are evicted (fail-closed for
 * new keys is deliberately *not* chosen — evicting oldest is safer against DoS
 * of the limiter itself).
 */

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
  /** Seconds the caller should wait; 0 when allowed. */
  retryAfter: number;
  limit: number;
}

export interface RateLimitRule {
  /** Unique name; also the audit-log / metrics label. */
  name: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Extra tokens allowed back-to-back (burst). */
  burst?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
  lastSeen: number;
}

export interface RateLimitStore {
  hit(key: string, rule: RateLimitRule, now: number): RateLimitDecision;
  reset(key: string): void;
  clear(): void;
  size(): number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxKeys = 20_000,
    private readonly sweepMs = 30_000,
  ) {
    const timer = setInterval(() => this.sweep(), sweepMs);
    // Never keep the process alive just for the sweeper.
    if (typeof timer.unref === 'function') timer.unref();
  }

  hit(key: string, rule: RateLimitRule, now: number): RateLimitDecision {
    const burst = rule.burst ?? 0;
    const capacity = rule.limit + burst;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.evictOldest();
      bucket = { count: 0, resetAt: now + rule.windowMs, lastSeen: now };
      this.buckets.set(key, bucket);
    }

    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + rule.windowMs;
    }

    bucket.count += 1;
    bucket.lastSeen = now;

    const allowed = bucket.count <= capacity;
    return {
      allowed,
      remaining: Math.max(0, capacity - bucket.count),
      resetAt: bucket.resetAt,
      retryAfter: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      limit: rule.limit,
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }

  size(): number {
    return this.buckets.size;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.sweepMs * 4;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt < cutoff) this.buckets.delete(key);
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeen < oldestSeen) {
        oldestSeen = bucket.lastSeen;
        oldestKey = key;
      }
    }
    if (oldestKey) this.buckets.delete(oldestKey);
  }
}

const globalKey = '__cybergridRateLimit';
const globalStore = (globalThis as Record<string, unknown>)[globalKey] as
  | MemoryRateLimitStore
  | undefined;
const store: RateLimitStore =
  globalStore ??
  ((globalThis as Record<string, unknown>)[globalKey] = new MemoryRateLimitStore());

export function rateLimitStore(): RateLimitStore {
  return store;
}

// ---------------------------------------------------------------------------
// Named rules
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RATE_RULES = {
  register: { name: 'auth.register', limit: 5, windowMs: HOUR, burst: 2 },
  login: { name: 'auth.login', limit: 10, windowMs: 15 * MINUTE, burst: 5 },
  'login-per-account': { name: 'auth.login.account', limit: 5, windowMs: 15 * MINUTE },
  logout: { name: 'auth.logout', limit: 30, windowMs: MINUTE },
  'verify-email': { name: 'auth.verify', limit: 10, windowMs: HOUR },
  'resend-verification': { name: 'auth.resend', limit: 3, windowMs: HOUR },
  'forgot-password': { name: 'auth.forgot', limit: 3, windowMs: HOUR, burst: 1 },
  'reset-password': { name: 'auth.reset', limit: 10, windowMs: HOUR },
  'change-password': { name: 'auth.change-password', limit: 6, windowMs: HOUR },
  'me': { name: 'api.me', limit: 240, windowMs: MINUTE },
  'game-save': { name: 'game.save', limit: 90, windowMs: MINUTE },
  'mission-attempt': { name: 'game.attempt', limit: 40, windowMs: MINUTE },
  'mission-start': { name: 'game.start', limit: 30, windowMs: MINUTE },
  'catalog': { name: 'api.catalog', limit: 300, windowMs: MINUTE },
  admin: { name: 'api.admin', limit: 120, windowMs: MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateRuleName = keyof typeof RATE_RULES;

export function checkRateLimit(rule: RateLimitRule, identity: string): RateLimitDecision {
  return store.hit(`${rule.name}:${identity}`, rule, Date.now());
}

export function consumeRateLimit(
  rule: RateLimitRule,
  identity: string,
): { ok: true; decision: RateLimitDecision } | { ok: false; decision: RateLimitDecision } {
  const decision = checkRateLimit(rule, identity);
  return decision.allowed ? { ok: true, decision } : { ok: false, decision };
}

export function resetRateLimit(rule: RateLimitRule, identity: string): void {
  store.reset(`${rule.name}:${identity}`);
}

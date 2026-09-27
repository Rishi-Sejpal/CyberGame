import 'server-only';

import { createHash } from 'node:crypto';
import {
  AuditLogModel,
  type AuditEvent,
  type AuditSeverity,
} from '@/server/db/models/audit-log.model';
import { connectDb } from '@/server/db/connect';

/**
 * Append-only security audit log with tamper evidence.
 *
 * Guarantees:
 *  - Writes never throw into the request path. A broken audit sink must not turn
 *    a successful login into a 500; the failure is reported to stderr instead.
 *  - Each entry hashes `prevHash + canonical(entry)`, forming a chain. Anyone
 *    with write access who edits or deletes an older row breaks every hash after
 *    it, which `verifyChain()` detects.
 *  - The chain head is cached for a short window to avoid a read per write on
 *    the hot path (login). The trade-off is documented: a few concurrent writes
 *    can race and fork the chain, which `verifyChain` reports rather than hides.
 */

const CHAIN_HEAD_TTL_MS = 2_000;

interface ChainHead {
  hash: string;
  fetchedAt: number;
}

let chainHead: ChainHead | null = null;
let pendingTail: Promise<string> = Promise.resolve('genesis');

export interface AuditInput {
  event: AuditEvent;
  severity?: AuditSeverity;
  userId?: string | null;
  actor?: string;
  ip?: string | null;
  userAgent?: string | null;
  outcome?: 'success' | 'failure' | 'blocked';
  metadata?: Record<string, unknown>;
}

/** Fields that must never reach the audit log, whatever the caller passes. */
const FORBIDDEN_METADATA_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'token',
  'code',
  'sessionToken',
  'cookie',
  'authorization',
  'body',
  'mongodbUri',
  'pepper',
]);

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) continue;
    if (value === undefined) continue;
    // Keep entries small; the log is a signal, not a data lake.
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 20).map((v) => (typeof v === 'string' ? v.slice(0, 80) : v));
    } else if (typeof value === 'object') {
      out[key] = '[object]';
    }
  }
  return out;
}

/**
 * The exact bytes that get hashed, in a fixed order.
 *
 * `createdAt` is passed in rather than read from the clock here: it has to be the
 * same value that ends up stored on the row, or `verifyChain` — which recomputes
 * from the stored timestamp — can never reproduce a healthy entry's hash and
 * reports an untouched log as tampered.
 */
function canonical(
  input: Omit<AuditInput, 'severity'> & { severity: AuditSeverity },
  createdAt: Date,
): string {
  return JSON.stringify([
    input.event,
    input.severity,
    input.userId ?? null,
    input.actor ?? 'anonymous',
    input.outcome ?? 'success',
    createdAt.toISOString(),
  ]);
}

/**
 * Drop the cached chain head.
 *
 * The cache assumes the process owns the tail of the log. Anything that empties or
 * replaces the collection behind it — a test truncating the database, an operator
 * rotating the log — must call this, or the next write links to a hash that is no
 * longer the head and the chain forks for good.
 */
export function resetAuditChainHead(): void {
  chainHead = null;
}

async function currentHead(): Promise<string> {
  if (chainHead && Date.now() - chainHead.fetchedAt < CHAIN_HEAD_TTL_MS) return chainHead.hash;
  const last = await AuditLogModel.findOne({}, { hash: 1 }).sort({ createdAt: -1 }).lean();
  const hash = last?.hash ?? 'genesis';
  chainHead = { hash, fetchedAt: Date.now() };
  return hash;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await connectDb();
    // Serialise chain writes so entries do not interleave.
    pendingTail = pendingTail.then(async () => {
      const severity: AuditSeverity = input.severity ?? defaultSeverity(input.event);
      const enriched: Omit<AuditInput, 'severity'> & { severity: AuditSeverity } = {
        ...input,
        severity,
        outcome: input.outcome ?? 'success',
        actor: input.actor ?? (input.userId ? `user:${input.userId}` : 'anonymous'),
        metadata: sanitizeMetadata(input.metadata),
      };
      const prevHash = await currentHead();
      const createdAt = new Date();
      const hash = createHash('sha256')
        .update(`${prevHash}\u0000${canonical(enriched, createdAt)}`)
        .digest('hex');
      await AuditLogModel.create({ ...enriched, prevHash, hash, createdAt });
      chainHead = { hash, fetchedAt: Date.now() };
      return hash;
    });
    await pendingTail;
  } catch (error) {
    // Deliberately swallowed: losing an audit row must not fail the action.
    console.error('[audit] failed to persist entry', {
      event: input.event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Fire-and-forget variant for paths that must not await the log write. */
export function auditDetached(input: AuditInput): void {
  void audit(input);
}

function defaultSeverity(event: AuditEvent): AuditSeverity {
  if (
    event === 'auth.password_reset_invalid_token' ||
    event === 'game.replay_detected' ||
    event === 'auth.csrf_rejected' ||
    event === 'account.role_changed' ||
    event === 'account.status_changed'
  ) {
    return 'critical';
  }
  if (
    event === 'auth.login.failure' ||
    event === 'auth.login.locked' ||
    event === 'auth.rate_limited' ||
    event === 'auth.register.duplicate' ||
    event === 'game.attempt_rejected' ||
    event === 'game.unauthorized_access' ||
    event === 'auth.session.revoked' ||
    event === 'admin.user_action'
  ) {
    return 'warning';
  }
  if (
    event === 'auth.register' ||
    event === 'auth.email_verified' ||
    event === 'auth.password_change' ||
    event === 'auth.password_reset_completed' ||
    event === 'game.mission_completed'
  ) {
    return 'notice';
  }
  return 'info';
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAt: string | null;
  reason: string | null;
}

/** Admin-only integrity check over the audit chain. */
export async function verifyChain(limit = 5_000): Promise<ChainVerification> {
  await connectDb();
  const entries = await AuditLogModel.find(
    {},
    {
      _id: 1,
      event: 1,
      severity: 1,
      userId: 1,
      actor: 1,
      outcome: 1,
      createdAt: 1,
      prevHash: 1,
      hash: 1,
    },
  )
    // `_id` breaks ties: writes are serialised, but several can share a
    // millisecond, and an unstable sort would report a healthy chain as forked.
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .lean();

  let prev = 'genesis';
  for (const entry of entries) {
    if ((entry.prevHash ?? 'genesis') !== prev) {
      return {
        ok: false,
        checked: entries.length,
        brokenAt: entry.hash,
        reason: 'prevHash mismatch',
      };
    }
    const expected = createHash('sha256')
      .update(
        `${prev}\u0000${JSON.stringify([
          entry.event,
          entry.severity,
          entry.userId ?? null,
          entry.actor ?? 'anonymous',
          entry.outcome ?? 'success',
          new Date(entry.createdAt).toISOString(),
        ])}`,
      )
      .digest('hex');
    if (expected !== entry.hash) {
      return { ok: false, checked: entries.length, brokenAt: entry.hash, reason: 'hash mismatch' };
    }
    prev = entry.hash;
  }
  return { ok: true, checked: entries.length, brokenAt: null, reason: null };
}

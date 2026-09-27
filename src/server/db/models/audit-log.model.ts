import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * `auditLogs` — append-only record of security-relevant events.
 *
 * Events recorded here: register, login success/failure, logout, logout-all,
 * password changed, password reset requested/completed, email verification,
 * role changes, admin actions, suspicious rate-limit trips, and progression
 * anomalies (replay attempts, impossible submissions).
 *
 * Deliberately NOT stored: raw passwords, session tokens, verification tokens,
 * full email addresses (only a masked form), or the raw request body.
 *
 * `hashChain` gives tamper evidence: each entry includes the SHA-256 of the
 * previous entry, so an operator with write access cannot quietly edit history
 * without breaking the chain.
 */

export const AUDIT_EVENTS = [
  'auth.register',
  'auth.register.duplicate',
  'auth.login.success',
  'auth.login.failure',
  'auth.login.locked',
  'auth.logout',
  'auth.logout_all',
  'auth.session.revoked',
  'auth.session.expired',
  'auth.email_verification_sent',
  'auth.email_verified',
  'auth.password_change',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'auth.password_reset_invalid_token',
  'auth.rate_limited',
  'auth.csrf_rejected',
  'account.profile_updated',
  'account.role_changed',
  'account.status_changed',
  'admin.content_updated',
  'admin.user_action',
  'game.mission_completed',
  'game.attempt_rejected',
  'game.replay_detected',
  'game.unauthorized_access',
  'system.seed',
  'system.error',
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];

export const AUDIT_SEVERITIES = ['info', 'notice', 'warning', 'critical'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export interface AuditLogDoc {
  _id: unknown;
  event: AuditEvent;
  severity: AuditSeverity;
  /** Null for pre-authentication events (e.g. a failed login for unknown user). */
  userId: string | null;
  /** Masked identifier, e.g. `a***@e***.com` or `ghost_operator`. */
  actor: string;
  ip: string | null;
  userAgent: string | null;
  /** Non-sensitive structured context. Never a full request body. */
  metadata: Record<string, unknown>;
  outcome: 'success' | 'failure' | 'blocked';
  /** SHA-256 of the previous entry's hash — tamper evidence. */
  prevHash: string | null;
  hash: string;
  createdAt: Date;
}

const auditLogSchema = defineSchema<AuditLogDoc>(
  {
    event: { type: String, required: true, enum: AUDIT_EVENTS, index: true },
    severity: { type: String, required: true, enum: AUDIT_SEVERITIES, default: 'info' },
    userId: { type: String, default: null },
    actor: { type: String, required: true, default: 'anonymous', maxlength: 80 },
    ip: { type: String, default: null, maxlength: 64 },
    userAgent: { type: String, default: null, maxlength: 400 },
    metadata: { type: Object, default: {} },
    outcome: {
      type: String,
      required: true,
      enum: ['success', 'failure', 'blocked'],
      default: 'success',
    },
    prevHash: { type: String, default: null },
    hash: { type: String, required: true },
  },
  { collection: 'auditLogs', timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

// Admin audit viewer: newest first, optionally filtered by event/severity.
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ severity: 1, createdAt: -1 });
auditLogSchema.index({ event: 1, createdAt: -1 });

export const AuditLogModel = registerModel<AuditLogDoc>('AuditLog', auditLogSchema);

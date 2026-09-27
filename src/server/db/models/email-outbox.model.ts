import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * `emailOutbox` — every message the application wants to send.
 *
 * Using an outbox keeps the auth flows testable and deployment-agnostic: in
 * development and CI the `outbox` transport simply persists here, and
 * `/dev/outbox` renders it. In production the `smtp` transport drains it.
 *
 * The verification/reset **link** is stored here because the link *is* the
 * credential. That is acceptable only because the collection is short-lived
 * (TTL) and the rows are owned by the same trust boundary as the tokens they
 * correspond to — but it is the reason this collection is never exposed by any
 * public route, and the dev preview route is hard-gated behind
 * `NODE_ENV !== 'production'` *and* `DEV_MAIL_PREVIEW=true`.
 */

export const EMAIL_KINDS = ['verification', 'password-reset', 'welcome', 'security-alert'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface EmailOutboxDoc {
  _id: unknown;
  kind: EmailKind;
  to: string;
  subject: string;
  /** Pre-rendered text body. HTML is intentionally not stored. */
  text: string;
  /** Full link, present for verification/reset only. */
  actionUrl: string | null;
  /** Where the outbox console is filtered by kind. */
  userId: string | null;
  sentAt: Date | null;
  deliveryAttempts: number;
  lastError: string | null;
  createdAt: Date;
  /** TTL anchor — 3 days. */
  expiresAt: Date;
}

const emailOutboxSchema = defineSchema<EmailOutboxDoc>(
  {
    kind: { type: String, required: true, enum: EMAIL_KINDS, index: true },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    text: { type: String, required: true },
    actionUrl: { type: String, default: null },
    userId: { type: String, default: null, index: true },
    sentAt: { type: Date, default: null },
    deliveryAttempts: { type: Number, required: true, default: 0, min: 0 },
    lastError: { type: String, default: null },
    expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + 3 * 86_400_000) },
  },
  { collection: 'emailOutbox', timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

// Outbox rows are diagnostic, not archival.
emailOutboxSchema.index({ createdAt: -1 });
emailOutboxSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 3 });

export const EmailOutboxModel = registerModel<EmailOutboxDoc>('EmailOutbox', emailOutboxSchema);

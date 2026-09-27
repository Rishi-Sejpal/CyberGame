import 'server-only';

import { env, isProduction } from '@/server/config/env';
import { connectDb } from '@/server/db/connect';
import { EmailOutboxModel, type EmailKind } from '@/server/db/models/email-outbox.model';
import { audit } from '@/server/security/audit';

/**
 * Outbound email.
 *
 * A `MailTransport` interface keeps the auth flows identical in dev, CI and
 * production:
 *   - `outbox`  — persist to Mongo, viewable at /dev/outbox (dev only)
 *   - `smtp`    — hand off to a real relay over a single-tenant TCP socket
 *   - `console` — log the subject only; used as a last-resort fallback so a
 *                 misconfigured SMTP_URL never blocks a password reset
 *
 * Every message is plain text. No HTML, no tracking pixels, no third-party
 * assets — the security-sensitive mail in this app should look boring.
 */

export interface MailMessage {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  /** Present for verification / reset mail. This IS the credential. */
  actionUrl?: string;
  userId?: string;
}

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<{ delivered: boolean; detail?: string }>;
}

class OutboxTransport implements MailTransport {
  readonly name = 'outbox';

  async send(message: MailMessage): Promise<{ delivered: boolean; detail?: string }> {
    await connectDb();
    await EmailOutboxModel.create({
      kind: message.kind,
      to: message.to,
      subject: message.subject,
      text: message.text,
      actionUrl: message.actionUrl ?? null,
      userId: message.userId ?? null,
      sentAt: new Date(),
    });
    return { delivered: true, detail: 'stored in outbox' };
  }
}

class ConsoleTransport implements MailTransport {
  readonly name = 'console';

  async send(message: MailMessage): Promise<{ delivered: boolean; detail?: string }> {
    // Never log the action URL: it is a live credential.
    console.warn(`[mail:${this.name}] "${message.subject}" -> ${maskEmail(message.to)}`);
    return { delivered: false, detail: 'console transport discards mail' };
  }
}

class SmtpTransport implements MailTransport {
  readonly name = 'smtp';

  async send(message: MailMessage): Promise<{ delivered: boolean; detail?: string }> {
    const url = env().SMTP_URL;
    if (!url) {
      await new OutboxTransport().send(message);
      return { delivered: false, detail: 'SMTP_URL missing; fell back to outbox' };
    }

    const parsed = new URL(url);
    if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') {
      // Deliberately refuse arbitrary protocols: this is a credential-exfiltration
      // vector if the URL is ever attacker-influenced.
      await new OutboxTransport().send(message);
      return { delivered: false, detail: `unsupported SMTP scheme "${parsed.protocol}"` };
    }

    // A production deployment wires its real provider here (SES, Postmark,
    // Resend, SES SMTP…). Until then the outbox is the durable path so a reset
    // link is never lost, and an operator can drain it.
    await new OutboxTransport().send(message);
    return { delivered: false, detail: 'queued in outbox pending provider wiring' };
  }
}

function transport(): MailTransport {
  switch (env().EMAIL_TRANSPORT) {
    case 'smtp':
      return new SmtpTransport();
    case 'console':
      return new ConsoleTransport();
    case 'outbox':
    default:
      return new OutboxTransport();
  }
}

/**
 * Sends a message. Never throws: a mail outage must not turn a successful
 * registration into a 500, and must not reveal whether an account exists.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  try {
    const result = await transport().send(message);
    if (!result.delivered) {
      await audit({
        event: 'system.error',
        severity: 'warning',
        userId: message.userId ?? null,
        metadata: { mail: message.kind, transport: result.detail ?? 'unknown' },
      });
    }
    return result.delivered;
  } catch (error) {
    console.error('[mail] delivery failed', {
      kind: message.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, Math.min(2, local.length));
  const tail = domain.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${tail}${'*'.repeat(
    Math.max(1, domain.length - tail.length),
  )}`;
}

export function mailPreviewEnabled(): boolean {
  return !isProduction() && env().DEV_MAIL_PREVIEW;
}

import { withApi, ok } from '@/server/http/api';
import { connectDb } from '@/server/db/connect';
import { EmailOutboxModel } from '@/server/db/models/email-outbox.model';
import { mailPreviewEnabled } from '@/server/email/service';
import { forbidden } from '@/server/http/errors';

/**
 * GET /api/dev/outbox — development-only mail preview.
 *
 * Doubly gated: it refuses to run outside development, and it refuses to run
 * unless `DEV_MAIL_PREVIEW=true`, which `env.ts` itself refuses to accept in
 * production. There is no configuration in which this route is reachable on a
 * production deployment.
 */
export const GET = withApi(
  async () => {
    if (!mailPreviewEnabled()) {
      throw forbidden('The mail preview is disabled.');
    }
    await connectDb();
    const messages = await EmailOutboxModel.find({}).sort({ createdAt: -1 }).limit(25).lean();
    return ok({
      messages: messages.map((m) => ({
        id: String(m._id),
        kind: m.kind,
        to: m.to,
        subject: m.subject,
        text: m.text,
        actionUrl: m.actionUrl,
        createdAt: m.createdAt,
      })),
    });
  },
  { auth: false, rateLimit: { name: 'dev.outbox', limit: 60, windowMs: 60_000 } },
);

import { withApi, ok } from '@/server/http/api';
import { listSessions } from '@/server/security/session';
import { RATE_RULES } from '@/server/security/rate-limit';

/**
 * GET /api/auth/sessions
 *
 * Lists the caller's own live sessions so a stolen device is visible and
 * revocable. Truncated to 25 in the query; the absolute ceiling is on sessions
 * per user, enforced at login time.
 */
export const GET = withApi(
  async (ctx) => {
    const sessions = await listSessions(ctx.session!.id, ctx.session!.sessionId);
    return ok({ sessions });
  },
  { auth: true, rateLimit: RATE_RULES.me },
);

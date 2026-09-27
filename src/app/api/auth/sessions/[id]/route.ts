import { withApi, ok } from '@/server/http/api';
import {
  destroyCurrentSession,
  revokeSessionById,
  sessionCookieName,
} from '@/server/security/session';
import { RATE_RULES } from '@/server/security/rate-limit';
import { parseOrThrow } from '@/server/http/errors';
import { objectIdSchema } from '@/server/validation/schemas';

/**
 * DELETE /api/auth/sessions/:id
 *
 * Revokes one session belonging to the caller.
 *
 * IDOR guard: `revokeSessionById` filters on `{ _id, userId }`, so presenting
 * another player's session id matches zero documents and is reported as 404
 * rather than 403 — the response must not confirm that the id exists.
 *
 * Revoking the session you are currently using also clears the cookie, so the
 * browser is not left holding a token that the server has already rejected.
 */
export const DELETE = withApi(
  async (ctx) => {
    const id = parseOrThrow(objectIdSchema, ctx.params.id);
    const revoked = await revokeSessionById(ctx.session!.id, id);

    if (!revoked) {
      const { notFound } = await import('@/server/http/errors');
      throw notFound('That session does not exist.');
    }

    if (id === ctx.session!.sessionId) {
      await destroyCurrentSession(ctx.cookies, ctx.cookies.get(sessionCookieName()));
    }

    return ok({ revoked, current: id === ctx.session!.sessionId });
  },
  { auth: true, rateLimit: RATE_RULES.me },
);

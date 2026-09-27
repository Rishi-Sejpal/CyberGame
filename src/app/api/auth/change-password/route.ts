import { withApi, ok } from '@/server/http/api';
import { parseOrThrow } from '@/server/http/errors';
import { changePasswordSchema, readJson } from '@/server/validation/schemas';
import { changePassword } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';

/** POST /api/auth/change-password — requires the current password. */
export const POST = withApi(
  async (ctx) => {
    const body = parseOrThrow(changePasswordSchema, await readJson(ctx.request));
    await changePassword(ctx.session!.id, body, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      sessionId: ctx.session!.sessionId,
    });
    return ok({ changed: true });
  },
  { auth: true, rateLimit: RATE_RULES['change-password'] },
);

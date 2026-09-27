import { withApi, ok } from '@/server/http/api';
import { parseOrThrow } from '@/server/http/errors';
import { resetPasswordSchema, readJson } from '@/server/validation/schemas';
import { resetPassword } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';
import { ensureCsrfToken } from '@/server/security/csrf';

/**
 * POST /api/auth/reset-password
 *
 * On success: the password is re-hashed, `users.sessionEpoch` is incremented and
 * every session row is revoked, so any cookie in any browser stops working
 * immediately. The caller is *not* logged in here — they must sign in again.
 */
export const POST = withApi(
  async (ctx) => {
    const body = parseOrThrow(resetPasswordSchema, await readJson(ctx.request));
    await resetPassword(body, { ip: ctx.ip, userAgent: ctx.userAgent });
    ensureCsrfToken(ctx.cookies);
    return ok({ reset: true });
  },
  { auth: false, rateLimit: RATE_RULES['reset-password'] },
);

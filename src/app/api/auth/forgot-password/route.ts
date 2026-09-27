import { withApi, ok } from '@/server/http/api';
import { parseOrThrow } from '@/server/http/errors';
import { forgotPasswordSchema, readJson } from '@/server/validation/schemas';
import { requestPasswordReset } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';

/**
 * POST /api/auth/forgot-password
 *
 * Always returns 200 with an identical body, and always performs comparable
 * work. This is the anti-enumeration contract for the whole flow.
 */
export const POST = withApi(
  async (ctx) => {
    const body = parseOrThrow(forgotPasswordSchema, await readJson(ctx.request));
    await requestPasswordReset(body.email, { ip: ctx.ip, userAgent: ctx.userAgent });
    return ok({
      message: 'If an account exists for that address, a reset link is on its way.',
    });
  },
  { auth: false, rateLimit: RATE_RULES['forgot-password'] },
);

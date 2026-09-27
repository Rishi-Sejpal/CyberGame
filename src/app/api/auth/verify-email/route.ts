import { withApi, ok } from '@/server/http/api';
import { parseOrThrow } from '@/server/http/errors';
import { verifyEmailSchema, readJson } from '@/server/validation/schemas';
import { verifyEmailToken } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';
import { ensureCsrfToken } from '@/server/security/csrf';

/**
 * POST /api/auth/verify-email
 *
 * The token is single-use and short-lived. A consumed/expired/garbage token all
 * produce the same generic failure so the endpoint cannot be used to test token
 * validity.
 */
export const POST = withApi(
  async (ctx) => {
    const body = parseOrThrow(verifyEmailSchema, await readJson(ctx.request));
    const user = await verifyEmailToken(body.token, { ip: ctx.ip, userAgent: ctx.userAgent });
    ensureCsrfToken(ctx.cookies);
    return ok({ user, verified: true });
  },
  { auth: false, rateLimit: RATE_RULES['verify-email'] },
);

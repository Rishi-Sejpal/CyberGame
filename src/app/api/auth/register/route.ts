import { withApi, created } from '@/server/http/api';
import { parseOrThrow } from '@/server/http/errors';
import { registerSchema, readJson } from '@/server/validation/schemas';
import { registerUser } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';
import { ensureCsrfToken } from '@/server/security/csrf';

/**
 * POST /api/auth/register
 *
 * Unauthenticated by design. Rate limited per IP here, and additionally by
 * `login-per-account` inside the service, so rotating IPs still cannot hammer a
 * single identity faster than the account throttle allows.
 */
export const POST = withApi(
  async (ctx) => {
    const body = parseOrThrow(registerSchema, await readJson(ctx.request));

    const user = await registerUser(
      body,
      { ip: ctx.ip, userAgent: ctx.userAgent, deviceLabel: ctx.deviceLabel },
      ctx.cookies,
    );

    // A CSRF cookie must exist before the client's next write.
    ensureCsrfToken(ctx.cookies);

    return created({ user, requiresEmailVerification: true });
  },
  { auth: false, rateLimit: RATE_RULES.register },
);

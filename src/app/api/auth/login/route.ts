import { withApi, ok } from '@/server/http/api';
import { parseOrThrow } from '@/server/http/errors';
import { loginSchema, readJson } from '@/server/validation/schemas';
import { loginUser } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';
import { ensureCsrfToken } from '@/server/security/csrf';

/** POST /api/auth/login — identifier may be a username or an email. */
export const POST = withApi(
  async (ctx) => {
    const body = parseOrThrow(loginSchema, await readJson(ctx.request));

    const user = await loginUser(
      body,
      { ip: ctx.ip, userAgent: ctx.userAgent, deviceLabel: ctx.deviceLabel },
      ctx.cookies,
    );

    ensureCsrfToken(ctx.cookies);

    return ok({ user, requiresEmailVerification: user.status === 'pending_verification' });
  },
  { auth: false, rateLimit: RATE_RULES.login },
);

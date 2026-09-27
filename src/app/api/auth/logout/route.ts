import { withApi, ok } from '@/server/http/api';
import { logoutUser } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';

/**
 * POST /api/auth/logout
 *
 * `auth: false` so an expired or revoked session can still clear its cookie —
 * logging out must never fail.
 */
export const POST = withApi(
  async (ctx) => {
    await logoutUser(
      { ip: ctx.ip, userAgent: ctx.userAgent, userId: ctx.session?.id },
      ctx.cookies,
    );
    return ok({ loggedOut: true });
  },
  { auth: false, rateLimit: RATE_RULES.logout },
);

import { withApi, ok } from '@/server/http/api';
import { resendVerification } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';

/** POST /api/auth/resend-verification — always reports success. */
export const POST = withApi(
  async (ctx) => {
    await resendVerification(ctx.session!.id, { ip: ctx.ip, userAgent: ctx.userAgent });
    return ok({ sent: true });
  },
  { auth: true, rateLimit: RATE_RULES['resend-verification'] },
);

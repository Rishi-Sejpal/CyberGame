import { withApi, ok } from '@/server/http/api';
import { logoutEverywhere } from '@/server/auth/service';

/** POST /api/auth/logout-all — revokes every session and bumps the epoch. */
export const POST = withApi(
  async (ctx) => {
    const revoked = await logoutEverywhere(ctx.session!.id, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return ok({ revoked });
  },
  { auth: true },
);

import { withApi, ok } from '@/server/http/api';
import { connectDb } from '@/server/db/connect';
import { ProfileModel } from '@/server/db/models/profile.model';
import { UserModel } from '@/server/db/models/user.model';
import { toPublicUser } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';
import { ensureCsrfToken } from '@/server/security/csrf';

/**
 * GET /api/auth/me
 *
 * The client calls this on boot to hydrate React state. It returns the smallest
 * useful projection — no password hash, no email lookup hash, no sessionEpoch,
 * no IP, no progression the client could try to edit.
 */
export const GET = withApi(
  async (ctx) => {
    await connectDb();
    const [user, profile] = await Promise.all([
      UserModel.findById(ctx.session!.id).lean(),
      ProfileModel.findOne({ userId: ctx.session!.id }).lean(),
    ]);
    if (!user) return ok({ user: null, profile: null });
    ensureCsrfToken(ctx.cookies);
    return ok({
      user: toPublicUser(user),
      profile: profile
        ? {
            handle: profile.handle,
            avatarId: profile.avatarId,
            xp: profile.xp,
            level: profile.level,
            xpIntoLevel: profile.xpIntoLevel,
            xpForNextLevel: profile.xpForNextLevel,
            tier: profile.tier,
            streakDays: profile.streakDays,
            longestStreakDays: profile.longestStreakDays,
            stats: profile.stats,
          }
        : null,
    });
  },
  { auth: true, rateLimit: RATE_RULES.me },
);

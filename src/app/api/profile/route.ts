import { withApi, ok } from '@/server/http/api';
import { connectDb } from '@/server/db/connect';
import { ProfileModel } from '@/server/db/models/profile.model';
import { UserModel } from '@/server/db/models/user.model';
import { GameSaveModel } from '@/server/db/models/game-save.model';
import { parseOrThrow } from '@/server/http/errors';
import { updateProfileSchema, readJson } from '@/server/validation/schemas';
import { toPublicUser } from '@/server/auth/service';
import { RATE_RULES } from '@/server/security/rate-limit';
import { audit } from '@/server/security/audit';

/**
 * GET  /api/profile — the player's own account, display name and settings.
 * PATCH /api/profile — display name, avatar and UI preferences.
 *
 * The PATCH schema is `.strict()`, so `role`, `xp`, `level`, `unlockedModules`
 * and every other progression field are rejected at the door rather than
 * silently ignored. Progression is only ever written by the progression service.
 */
export const GET = withApi(
  async (ctx) => {
    await connectDb();
    const [user, profile, save] = await Promise.all([
      UserModel.findById(ctx.session!.id).lean(),
      ProfileModel.findOne({ userId: ctx.session!.id }).lean(),
      GameSaveModel.findOne({ userId: ctx.session!.id }).lean(),
    ]);

    if (!user) return ok({ user: null, profile: null, save: null });

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
            unlockedModules: profile.unlockedModules,
            unlockedLevels: profile.unlockedLevels,
            stats: profile.stats,
            createdAt: profile.createdAt,
          }
        : null,
      save: save
        ? {
            worldId: save.worldId,
            sceneKey: save.sceneKey,
            x: save.x,
            y: save.y,
            facing: save.facing,
            activeMissionId: save.activeMissionId,
            openPanel: save.openPanel,
            savedAt: save.savedAt,
            revision: save.revision,
          }
        : null,
    });
  },
  { auth: true, rateLimit: RATE_RULES.me },
);

export const PATCH = withApi(
  async (ctx) => {
    const body = parseOrThrow(updateProfileSchema, await readJson(ctx.request));
    await connectDb();

    const changes: Record<string, unknown> = {};
    if (body.displayName) changes.displayName = body.displayName;
    if (body.avatarId) changes.avatarId = body.avatarId;

    const [user, profile] = await Promise.all([
      body.displayName
        ? UserModel.findByIdAndUpdate(
            ctx.session!.id,
            { $set: { displayName: body.displayName } },
            { returnDocument: 'after' },
          ).lean()
        : UserModel.findById(ctx.session!.id).lean(),
      Boolean(body.displayName)
        ? ProfileModel.findOneAndUpdate(
            { userId: ctx.session!.id },
            { $set: body.displayName ? { handle: body.displayName } : {} },
            { returnDocument: 'after' },
          ).lean()
        : ProfileModel.findOne({ userId: ctx.session!.id }).lean(),
    ]);

    if (!user || !profile) {
      return ok({ updated: false });
    }

    if (body.settings) {
      // Settings live on the save document; `$set` on a dotted key means a
      // malicious key such as "$where" is impossible — the schema is strict and
      // the client can only supply primitive values.
      await GameSaveModel.updateOne(
        { userId: ctx.session!.id },
        {
          $set: Object.fromEntries(
            Object.entries(body.settings).map(([key, value]) => [`settings.${key}`, value]),
          ),
          $inc: { revision: 1 },
          $currentDate: { savedAt: true },
        },
        { upsert: true },
      );
    }

    await audit({
      event: 'account.profile_updated',
      userId: ctx.session!.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { fields: Object.keys(body).join(',') },
    });

    return ok({
      updated: true,
      user: toPublicUser(user),
      profile: {
        handle: profile.handle,
        avatarId: profile.avatarId,
        xp: profile.xp,
        level: profile.level,
        tier: profile.tier,
        streakDays: profile.streakDays,
        stats: profile.stats,
      },
    });
  },
  { auth: true, rateLimit: RATE_RULES.me },
);

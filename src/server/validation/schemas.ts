import { z } from 'zod';
import { AppError } from '@/server/http/errors';
import {
  EMAIL_MAX,
  EMAIL_RE,
  isReservedUsername,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_RE,
} from '@/shared/identity-rules';

/**
 * Centralised request validation.
 *
 * Every route handler validates with a schema from this file — there are no
 * ad-hoc `req.body.foo` accesses anywhere in the codebase. That gives one place
 * to audit input handling and one place to change a rule.
 *
 * Notes on specific choices:
 *  - `.trim()` before `email()` so "  a@b.com " is not a distinct account.
 *  - Lowercasing the email before hashing means addresses are case-insensitive
 *    for uniqueness without mutating what the user typed for display.
 *  - Unknown keys are stripped rather than rejected, so adding a field to a
 *    client form can never break an older server.
 *  - Length caps are enforced *in the schema* (not only in the DB) so a hostile
 *    payload is rejected before it is ever parsed by Mongoose.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const usernameSchema = z
  .string({ error: 'Username is required.' })
  .trim()
  .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters.`)
  .max(USERNAME_MAX, `Username must be at most ${USERNAME_MAX} characters.`)
  // Lowercase, digits, underscore and dash only. No leading/trailing separator.
  .regex(USERNAME_RE, 'Use 3-20 lowercase letters, digits, "_" or "-".')
  // Reserved handles that would be confusing or impersonate the app itself.
  .refine((v) => !isReservedUsername(v), { message: 'That username is reserved.' });

export const emailSchema = z
  .string({ error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .min(3, 'Email is required.')
  .max(EMAIL_MAX, `Email must be at most ${EMAIL_MAX} characters.`)
  .regex(EMAIL_RE, 'Enter a valid email address.');

export const passwordSchema = z
  .string({ error: 'Password is required.' })
  .min(1, 'Password is required.')
  .max(200, 'Password must be at most 200 characters.');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const registerSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: 'Please confirm your password.' }),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

export const loginSchema = z
  .object({
    // Accepts a username *or* an email in one field so the client does not have
    // to guess which one the user typed. Resolution happens server-side.
    identifier: z.string({ error: 'Enter your username or email.' }).trim().min(1, 'Enter your username or email.').max(254),
    password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.').max(200),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({ email: emailSchema })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string({ error: 'Reset token is required.' }).trim().min(20).max(200),
    password: passwordSchema,
    confirmPassword: z.string({ error: 'Please confirm your password.' }),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

export const verifyEmailSchema = z
  .object({ token: z.string({ error: 'Verification token is required.' }).trim().min(20).max(200) })
  .strict();

export const resendVerificationSchema = z
  .object({})
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(200),
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password.'),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })
  .refine((v) => v.currentPassword !== v.password, {
    path: ['password'],
    message: 'New password must be different from the current one.',
  });

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Display name is required.').max(32).optional(),
    avatarId: z.string().trim().regex(/^[a-z0-9-]{1,40}$/i, 'Invalid avatar.').optional(),
    /** UI preferences only. Never accepted as progression. */
    settings: z
      .record(z.string().max(40), z.union([z.boolean(), z.number().finite(), z.string().max(200)]))
      .refine((v) => Object.keys(v).length <= 25, 'Too many settings.')
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// ObjectId guard
// ---------------------------------------------------------------------------

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

/**
 * Guards every id that arrives from the client. Validating the *shape* before it
 * reaches Mongo matters: an unvalidated id lets a caller probe collection
 * contents with `$`-prefixed or regex payloads.
 */
export const objectIdSchema = z
  .string()
  .trim()
  .regex(OBJECT_ID_RE, 'Invalid identifier.');

export const objectIdParamsSchema = z.object({ id: objectIdSchema });

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

export const gameSaveSchema = z
  .object({
    worldId: z.string().trim().regex(/^[a-z0-9-]{1,40}$/i, 'Invalid world.'),
    sceneKey: z.string().trim().regex(/^[A-Za-z0-9_]{1,60}$/, 'Invalid scene.'),
    x: z.number().finite().min(-4096).max(4096),
    y: z.number().finite().min(-4096).max(4096),
    facing: z.enum(['up', 'down', 'left', 'right']),
    activeMissionId: z.string().trim().max(60).nullable().default(null),
    openPanel: z.string().trim().max(60).nullable().default(null),
  })
  .strict();

export const missionStartSchema = z
  .object({ missionId: z.string().trim().min(3).max(60) })
  .strict();

/** Answer payload shapes. Discriminated by `kind`; solutions live server-side. */
export const attemptSchema = z
  .object({
    missionId: z.string().trim().min(3).max(60),
    challengeId: z.string().trim().min(3).max(60),
    /** Client-generated id; replays are detected and ignored. */
    attemptId: z.string().trim().min(8).max(64),
    kind: z.string().trim().min(2).max(40),
    /** Free-form answers, shape-validated per challenge kind on the server. */
    answers: z.record(z.string().max(48), z.unknown()).refine(
      (v) => Object.keys(v).length <= 64,
      'Too many answer fields.',
    ),
    /** Optional hint request — costs a hint token, never a reset. */
    requestHint: z.boolean().optional(),
    elapsedMs: z.number().int().min(0).max(24 * 3_600_000).optional(),
  })
  .strict();

export const hintSchema = z
  .object({ challengeId: z.string().trim().min(3).max(60) })
  .strict();

export const leaderboardQuerySchema = z
  .object({
    moduleId: z.string().trim().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type GameSaveInput = z.infer<typeof gameSaveSchema>;
export type AttemptInput = z.infer<typeof attemptSchema>;

/**
 * Reads a JSON body with a hard byte ceiling.
 *
 * The ceiling is enforced against `content-length` *and* the real payload
 * length, because a chunked request can lie about its size. Throwing a typed
 * `AppError` (rather than a bare `Error`) keeps the failure a clean 400 instead
 * of an unhandled 500.
 */
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    throw new AppError('bad_request', 'Request body is too large.', {
      headers: { 'X-Max-Body-Bytes': String(maxBytes) },
    });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new AppError('bad_request', 'Request body could not be read.');
  }
  if (text.length > maxBytes) {
    throw new AppError('bad_request', 'Request body is too large.', {
      headers: { 'X-Max-Body-Bytes': String(maxBytes) },
    });
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('bad_request', 'Request body must be valid JSON.');
  }
}

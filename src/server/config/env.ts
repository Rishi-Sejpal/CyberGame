import 'server-only';

import { z } from 'zod';

/**
 * Centralised, validated environment configuration.
 *
 * Rules this module enforces:
 *  1. The whole surface is parsed once, at first import, from a zod schema.
 *  2. Production boots fail-fast when a secret is missing, too short, or when a
 *     development-only convenience flag is left switched on.
 *  3. Nothing here is ever serialised into a client bundle — `env.ts` lives
 *     behind `server-only` and is only reachable from route handlers and
 *     server components.
 *  4. `publicEnv()` is the ONLY function allowed to return values that may be
 *     embedded in the browser, and it is restricted to a hard-coded allowlist.
 */

const NODE_ENV_VALUES = ['development', 'test', 'production'] as const;
type NodeEnv = (typeof NODE_ENV_VALUES)[number];

const isTest = process.env.NODE_ENV === 'test';

const csv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

/** Rejects values that are obviously placeholders before they reach production. */
const PLACEHOLDER_PATTERN =
  /^(change[-_ ]?me|dev[-_ ]?only|placeholder|example|your[-_ ]?|todo|xxx+)/i;

const secretString = (label: string, minLength = 32) =>
  z
    .string()
    .min(minLength, `${label} must be at least ${minLength} characters`)
    .refine((value) => !PLACEHOLDER_PATTERN.test(value), {
      message: `${label} still looks like a placeholder value`,
    });

const rawSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENV_VALUES).default('development'),

    APP_URL: z.string().url('APP_URL must be an absolute URL').default('http://localhost:3000'),
    ALLOWED_ORIGINS: z.string().optional(),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    TEST_MONGODB_URI: z.string().optional(),

    SESSION_SECRET: secretString('SESSION_SECRET'),
    PASSWORD_PEPPER: secretString('PASSWORD_PEPPER'),

    ARGON2_MEMORY_COST: z.coerce.number().int().min(8 * 1024).max(1024 * 1024).default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),

    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
    SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('cg_session'),
    CSRF_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('cg_csrf'),

    EMAIL_TRANSPORT: z.enum(['outbox', 'smtp', 'console']).default('outbox'),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().min(3).default('CYBERGRID <no-reply@cybergrid.local>'),

    AUTO_SEED_CONTENT: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    DEV_MAIL_PREVIEW: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    AUTH_TEST_FAST_HASH: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;

    if (!value.APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'APP_URL must use https in production',
      });
    }

    if (value.EMAIL_TRANSPORT === 'smtp' && !value.SMTP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'SMTP_URL is required when EMAIL_TRANSPORT=smtp',
      });
    }

    for (const flag of ['AUTO_SEED_CONTENT', 'DEV_MAIL_PREVIEW', 'AUTH_TEST_FAST_HASH'] as const) {
      if (value[flag]) {
        ctx.addIssue({
          code: 'custom',
          path: [flag],
          message: `${flag} must never be enabled in production`,
        });
      }
    }
  });

export type Env = z.infer<typeof rawSchema>;

function loadEnv(): Env {
  const parsed = rawSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        'Copy .env.example to .env.local and fill in the values. See docs/SECURITY.md.',
    );
  }

  const env = parsed.data;

  return {
    ...env,
    APP_URL: env.APP_URL.replace(/\/+$/, ''),
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS ?? env.APP_URL,
  } satisfies Env & { ALLOWED_ORIGINS: string };
}

let cached: Env | undefined;

/** Lazily parsed configuration. Throws on first access if the env is invalid. */
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

export function isProduction(): boolean {
  return (process.env.NODE_ENV as NodeEnv | undefined) === 'production';
}

export function isDevelopment(): boolean {
  return (process.env.NODE_ENV as NodeEnv | undefined) === 'development';
}

export function isTestEnv(): boolean {
  return isTest;
}

/** Origins permitted to make state-changing requests. Always includes APP_URL. */
export function allowedOrigins(): string[] {
  const { APP_URL, ALLOWED_ORIGINS } = env();
  const set = new Set<string>([new URL(APP_URL).origin]);
  for (const origin of csv(ALLOWED_ORIGINS)) {
    try {
      set.add(new URL(origin).origin);
    } catch {
      // A malformed entry is ignored rather than taking the whole app down;
      // deployment configuration is validated loudly by the health endpoint.
    }
  }
  return [...set];
}

export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return allowedOrigins().includes(origin);
}

/** True when cookies must carry the `Secure` attribute. */
export function useSecureCookies(): boolean {
  return isProduction() || new URL(env().APP_URL).protocol === 'https:';
}

export function mongodbUri(): string {
  const { TEST_MONGODB_URI } = env();
  if (isTest && TEST_MONGODB_URI) return TEST_MONGODB_URI;
  return env().MONGODB_URI;
}

/**
 * Argon2id parameters. Tests use deliberately cheap parameters so the suite
 * stays fast; production refuses to boot with `AUTH_TEST_FAST_HASH=true`.
 */
export function argon2Params() {
  const e = env();
  const fast = e.AUTH_TEST_FAST_HASH && !isProduction();
  return {
    algorithm: 2 as const, // argon2id
    memoryCost: fast ? 256 : e.ARGON2_MEMORY_COST,
    timeCost: fast ? 1 : e.ARGON2_TIME_COST,
    parallelism: fast ? 1 : e.ARGON2_PARALLELISM,
  };
}

/** Hard-coded allowlist. Adding a key here is a deliberate, reviewable act. */
type PublicEnv = { APP_URL: string };

/**
 * The only sanctioned way to hand configuration to the browser. Anything not
 * named in `PUBLIC_ALLOWLIST` cannot be leaked through this function.
 */
export function publicEnv(): PublicEnv {
  const e = env();
  return { APP_URL: e.APP_URL };
}

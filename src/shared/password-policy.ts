/**
 * Password policy — the single source of truth, importable from the browser.
 *
 * This file has **no imports** and no `server-only` marker on purpose. Both
 * `src/server/security/password.ts` (which hashes) and the Client Components
 * (which render a live strength meter) call `checkPasswordPolicy` from here, so
 * a rule can never be tightened on the server while the form keeps advertising
 * the old one. The server result is still authoritative; the client copy exists
 * only so the player is not told "too short" after pressing submit.
 *
 * Nothing in this file is a secret. The policy is fully described by its rules.
 */

export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 200,
  minClasses: 3,
  /** Rejected outright: the credentials everybody tries first. */
  commonPasswords: [
    'password',
    'password1',
    'password123',
    'passw0rd',
    '12345678',
    '123456789',
    '1234567890',
    'qwertyuiop',
    'letmein123',
    'iloveyou',
    'admin123',
    'administrator',
    'welcome123',
    'changeme',
    'trustno1',
    'monkey123',
    'dragon123',
    'football123',
    'baseball123',
    'superman123',
    'starwars123',
    'cyber123',
    'hackerman',
    'letmein',
    'football',
    'baseball',
    'shadow',
    'master',
    'dragon',
    'monkey',
    'abc123',
  ],
} as const;

const COMMON = new Set<string>(PASSWORD_POLICY.commonPasswords);

/**
 * Substring matching only kicks in from this length. Below it, a match is more
 * likely to be a coincidence inside a legitimate passphrase than a real common
 * credential ("dragon" in "dragonfly" is worth rejecting, "cat" in "catalog" is
 * not).
 */
const COMMON_SUBSTRING_MIN_LENGTH = 6;

/**
 * Folds the substitutions people actually use to defeat a common-password list.
 *
 * Without this, `Password123!` and `p@ssw0rd` sail past a list that contains
 * "password" — the exact strings an attacker tries first. Mapping the whole
 * password (not just the candidate credential) keeps the comparison symmetric.
 */
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
  '!': 'i',
};

function foldLeet(value: string): string {
  return value
    .toLowerCase()
    .replace(/[013457@$!]/g, (char) => LEET[char] ?? char);
}

/** Common credentials folded the same way, so both sides of the comparison match. */
const COMMON_FOLDED: readonly string[] = PASSWORD_POLICY.commonPasswords
  .filter((entry) => entry.length >= COMMON_SUBSTRING_MIN_LENGTH)
  .map(foldLeet);

function isCommonCredential(value: string): boolean {
  const lower = value.toLowerCase();
  // Exact match first, on the raw text: it catches short entries and any
  // all-digit run like "12345678" that leet folding would mangle.
  if (COMMON.has(lower)) return true;
  const folded = foldLeet(lower);
  return COMMON_FOLDED.some((entry) => folded.includes(entry));
}

export type PasswordIssue =
  | `too_short_min_${number}`
  | `too_long_max_${number}`
  | 'needs_lowercase'
  | 'needs_uppercase'
  | 'needs_digit'
  | 'needs_symbol'
  | 'needs_three_classes'
  | 'too_common'
  | 'contains_username'
  | 'contains_email';

export interface PasswordPolicyResult {
  ok: boolean;
  /** Machine-readable reason codes. The UI maps these to friendly copy. */
  issues: PasswordIssue[];
}

/** Human copy for each reason code. Length rules are templated from the policy. */
const POLICY_MESSAGES: Record<PasswordIssue, string> = {
  needs_lowercase: 'Add a lowercase letter.',
  needs_uppercase: 'Add an uppercase letter.',
  needs_digit: 'Add a digit.',
  needs_symbol: 'Add a symbol such as ! ? @ #.',
  needs_three_classes: 'Use at least three of: lowercase, uppercase, digits, symbols.',
  too_common: 'That password is too common. Choose something less guessable.',
  contains_username: 'Your password must not contain your username.',
  contains_email: 'Your password must not contain your email address.',
} as Record<PasswordIssue, string>;

export function passwordIssueMessage(issue: PasswordIssue): string {
  if (issue.startsWith('too_short_min_')) {
    return `Password must be at least ${PASSWORD_POLICY.minLength} characters.`;
  }
  if (issue.startsWith('too_long_max_')) {
    return `Password must be at most ${PASSWORD_POLICY.maxLength} characters.`;
  }
  return POLICY_MESSAGES[issue] ?? 'Choose a stronger password.';
}

/**
 * Collapses every issue into one sentence.
 *
 * Length problems are reported alone: telling a 6-character password it is
 * "missing a digit" is noise, and it would coach the player toward a short but
 * well-formed password.
 */
export function passwordPolicyMessage(issues: readonly PasswordIssue[]): string {
  if (issues.length === 0) return '';
  if (issues.some((issue) => issue.startsWith('too_short'))) {
    return `Password must be at least ${PASSWORD_POLICY.minLength} characters.`;
  }
  if (issues.some((issue) => issue.startsWith('too_long'))) {
    return `Password must be at most ${PASSWORD_POLICY.maxLength} characters.`;
  }
  return issues.map((issue) => passwordIssueMessage(issue)).join(' ');
}

/**
 * Pure policy check. Used by the register/reset/change endpoints AND by the
 * client form; the server verdict always wins.
 */
export function checkPasswordPolicy(
  password: string,
  context: { username?: string; email?: string } = {},
): PasswordPolicyResult {
  const issues: PasswordIssue[] = [];
  const value = typeof password === 'string' ? password : '';

  if (value.length < PASSWORD_POLICY.minLength) {
    issues.push(`too_short_min_${PASSWORD_POLICY.minLength}` as PasswordIssue);
  }
  if (value.length > PASSWORD_POLICY.maxLength) {
    issues.push(`too_long_max_${PASSWORD_POLICY.maxLength}` as PasswordIssue);
  }

  const lower = value.toLowerCase();
  if (isCommonCredential(value)) issues.push('too_common');

  // Personal-data checks stop the most trivial targeted guesses.
  const username = context.username?.trim();
  if (username && username.length >= 3 && lower.includes(username.toLowerCase())) {
    issues.push('contains_username');
  }
  const local = context.email?.split('@')[0]?.trim();
  if (local && local.length >= 3 && lower.includes(local.toLowerCase())) {
    issues.push('contains_email');
  }

  const classes: Array<[PasswordIssue, boolean]> = [
    ['needs_lowercase', /[a-z]/.test(value)],
    ['needs_uppercase', /[A-Z]/.test(value)],
    ['needs_digit', /\d/.test(value)],
    ['needs_symbol', /[^A-Za-z0-9]/.test(value)],
  ];
  for (const [issue, present] of classes) {
    if (!present) issues.push(issue);
  }

  const presentCount = classes.filter(([, present]) => present).length;
  // The per-class issues above are the actionable ones; this is the summary
  // complaint, so it is only raised when the user is genuinely below the bar.
  if (presentCount < PASSWORD_POLICY.minClasses) issues.push('needs_three_classes');

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

// ---------------------------------------------------------------------------
// Strength meter
// ---------------------------------------------------------------------------

export type StrengthLabel = 'empty' | 'very-weak' | 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordStrength {
  /** 0-4, saturating well before the policy minimum so the meter moves early. */
  score: 0 | 1 | 2 | 3 | 4;
  label: StrengthLabel;
  /** The policy is satisfied. */
  acceptable: boolean;
  /** Short guidance for the player, or '' once acceptable. */
  hint: string;
}

/**
 * Common patterns that inflate a naive entropy estimate.
 *
 * These carry no message: the meter explains itself only through the policy
 * violation it is reporting, so a password that *passes* the policy is never
 * annotated with advice the policy does not actually require.
 */
const WEAK_PATTERNS: readonly RegExp[] = [
  /(.)\1{2,}/, // repeated character runs
  /^(?:19|20)\d{2}$/, // a bare year
  /1234|2345|3456|4567|5678|6789/, // a number sequence
];

/**
 * Physical key rows, read as a set of adjacent-key runs.
 *
 * A regex for "qwerty" only catches the one spelling. A real walk is
 * `qwe-rty`, `asdf_jkl` or `Zxcv!Bnm`, and a length-and-class counter scores
 * all of them as strong. Comparing against every 4-character window of each row,
 * in both directions, catches the walk whatever separators sit between the keys
 * and accounts for the finger slip in `asdfjkl`.
 *
 * A 4-character window is the compromise: 3 windows also match innocent runs
 * like "asdf" inside a random passphrase, and 5 misses `asdfjkl` entirely. The
 * cost of a false positive is one bar on a display-only meter.
 */
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'] as const;
const WALK_WINDOW = 4;
/** At most this many steps are subtracted, so a long patterned string is not zeroed. */
const MAX_WALK_PENALTY = 2;

function countKeyboardWalks(value: string): number {
  const skeleton = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (skeleton.length < WALK_WINDOW) return 0;
  let walks = 0;
  for (const row of KEYBOARD_ROWS) {
    for (let start = 0; start + WALK_WINDOW <= row.length; start += 1) {
      const window = row.slice(start, start + WALK_WINDOW);
      if (skeleton.includes(window)) walks += 1;
      // Walks are typed in either direction.
      if (skeleton.includes([...window].reverse().join(''))) walks += 1;
    }
  }
  return walks;
}

/**
 * A deliberately conservative 0-4 estimate for the meter.
 *
 * This is *not* a real entropy calculation and must never be used to gate
 * anything — `checkPasswordPolicy` is the gate. Its only job is to give the
 * player honest feedback while typing. Penalties for keyboard walks and repeats
 * matter because those passwords score well on naive length-and-class counts
 * while being trivially guessable.
 */
export function scorePassword(
  password: string,
  context: { username?: string; email?: string } = {},
): PasswordStrength {
  const value = typeof password === 'string' ? password : '';
  if (value.length === 0) {
    return { score: 0, label: 'empty', acceptable: false, hint: '' };
  }

  const { ok, issues } = checkPasswordPolicy(value, context);
  if (issues.some((issue) => issue.startsWith('too_short') || issue.startsWith('too_long'))) {
    return {
      score: 0,
      label: 'very-weak',
      acceptable: false,
      hint: passwordPolicyMessage(issues),
    };
  }

  // Character-class variety and a length term. `log2`-free on purpose: this only
  // needs to be monotonic in real strength for a four-step display.
  const classes = new Set(
    value.split('').map((ch) => {
      if (/[a-z]/.test(ch)) return 'lower';
      if (/[A-Z]/.test(ch)) return 'upper';
      if (/\d/.test(ch)) return 'digit';
      return 'symbol';
    }),
  ).size;

  let score = Math.min(4, Math.max(1, Math.floor(value.length / 6) + (classes - 1)));

  const walks = countKeyboardWalks(value);
  if (walks > 0) score = Math.max(1, score - Math.min(MAX_WALK_PENALTY, walks));
  for (const pattern of WEAK_PATTERNS) {
    if (pattern.test(value)) {
      score = Math.max(1, score - 1);
      break;
    }
  }
  if (issues.includes('too_common') || issues.includes('contains_username') || issues.includes('contains_email')) {
    score = 0;
  }

  const label: StrengthLabel =
    score <= 0 ? 'very-weak' : score === 1 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';

  return {
    score: score as 0 | 1 | 2 | 3 | 4,
    label,
    acceptable: ok,
    hint: ok ? '' : passwordPolicyMessage(issues),
  };
}

/** Tailwind class for a strength step. Kept next to the score so they stay in sync. */
export function strengthColor(label: StrengthLabel): string {
  switch (label) {
    case 'empty':
      return 'bg-line';
    case 'very-weak':
      return 'bg-rose';
    case 'weak':
      return 'bg-amber';
    case 'fair':
      return 'bg-lime';
    case 'good':
      return 'bg-cyan';
    case 'strong':
      return 'bg-neon';
  }
}

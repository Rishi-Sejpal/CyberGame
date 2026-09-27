/**
 * Client-side form validation.
 *
 * Purpose-built rather than a copy of the Zod schemas: Zod is correct but heavy
 * for keystroke-level validation, and the server schemas live behind
 * `server-only`. The duplication risk is handled by keeping the rules
 * deliberately conservative — every rule here is a *subset* check that the
 * server also enforces, so a form that passes client validation can still fail
 * server validation, but never the other way round. The server message always
 * wins and replaces whatever is shown here.
 *
 * The username and email rules are imported from `@/shared/password-policy`? No —
 * they live next door in `identity-rules.ts` so both this module and the server
 * schemas can share the exact regexes.
 */

import { PASSWORD_POLICY, checkPasswordPolicy, type PasswordIssue } from './password-policy';
import { USERNAME_RE, EMAIL_RE, isReservedUsername, usernameLengthError } from './identity-rules';

export type FieldName = string;

export type FormErrors = Partial<Record<FieldName, string>>;

export interface ValidateResult {
  ok: boolean;
  errors: FormErrors;
}

const ok: ValidateResult = { ok: true, errors: {} };

function fail(errors: FormErrors): ValidateResult {
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Single-field rules
// ---------------------------------------------------------------------------

export function validateUsername(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'Choose a callsign.';
  if (!USERNAME_RE.test(trimmed)) {
    return 'Use 3-20 lowercase letters, digits, "_" or "-", with no leading or trailing separator.';
  }
  if (isReservedUsername(trimmed)) return 'That callsign is reserved.';
  return undefined;
}

export function validateEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter your email address.';
  if (trimmed.length > 254) return 'Email must be at most 254 characters.';
  if (!EMAIL_RE.test(trimmed)) return 'Enter a valid email address.';
  return undefined;
}

export function validatePassword(
  value: string,
  context: { username?: string; email?: string } = {},
): string | undefined {
  if (!value) return 'Choose a password.';
  const result = checkPasswordPolicy(value, context);
  if (result.ok) return undefined;
  return summariseIssues(result.issues);
}

export function validateConfirmation(value: string, original: string): string | undefined {
  if (!value) return 'Confirm your password.';
  if (value !== original) return 'Passwords do not match.';
  return undefined;
}

/** Mirrors the server's `policyMessage`, including its length-first behaviour. */
function summariseIssues(issues: readonly PasswordIssue[]): string {
  if (issues.some((issue) => issue.startsWith('too_short'))) {
    return `Password must be at least ${PASSWORD_POLICY.minLength} characters.`;
  }
  if (issues.some((issue) => issue.startsWith('too_long'))) {
    return `Password must be at most ${PASSWORD_POLICY.maxLength} characters.`;
  }
  return issues.map(describeIssue).join(' ');
}

const ISSUE_TEXT: Record<PasswordIssue, string> = {
  needs_lowercase: 'Add a lowercase letter.',
  needs_uppercase: 'Add an uppercase letter.',
  needs_digit: 'Add a digit.',
  needs_symbol: 'Add a symbol such as ! ? @ #.',
  needs_three_classes: 'Use at least three of: lowercase, uppercase, digits, symbols.',
  too_common: 'That password is too common. Choose something less guessable.',
  contains_username: 'Your password must not contain your callsign.',
  contains_email: 'Your password must not contain your email address.',
} as Record<PasswordIssue, string>;

function describeIssue(issue: PasswordIssue): string {
  return ISSUE_TEXT[issue] ?? 'Choose a stronger password.';
}

// ---------------------------------------------------------------------------
// Whole-form rules
// ---------------------------------------------------------------------------

export interface LoginValues {
  identifier: string;
  password: string;
}

export function validateLogin(values: LoginValues): ValidateResult {
  const errors: FormErrors = {};
  if (!values.identifier.trim()) errors.identifier = 'Enter your callsign or email.';
  else if (values.identifier.trim().length > 254) errors.identifier = 'That is too long.';
  if (!values.password) errors.password = 'Enter your password.';
  return Object.keys(errors).length ? fail(errors) : ok;
}

export interface RegisterValues {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function validateRegister(values: RegisterValues): ValidateResult {
  const errors: FormErrors = {};

  const username = validateUsername(values.username);
  if (username) errors.username = username;

  const email = validateEmail(values.email);
  if (email) errors.email = email;

  const password = validatePassword(values.password, { username: values.username, email: values.email });
  if (password) errors.password = password;

  const confirm = validateConfirmation(values.confirmPassword, values.password);
  if (confirm) errors.confirmPassword = confirm;

  return Object.keys(errors).length ? fail(errors) : ok;
}

export interface ResetValues {
  password: string;
  confirmPassword: string;
}

export function validateReset(
  values: ResetValues,
  context: { username?: string; email?: string } = {},
): ValidateResult {
  const errors: FormErrors = {};

  const password = validatePassword(values.password, context);
  if (password) errors.password = password;

  const confirm = validateConfirmation(values.confirmPassword, values.password);
  if (confirm) errors.confirmPassword = confirm;

  return Object.keys(errors).length ? fail(errors) : ok;
}

export interface ChangePasswordValues {
  currentPassword: string;
  password: string;
  confirmPassword: string;
}

export function validateChangePassword(
  values: ChangePasswordValues,
  context: { username?: string; email?: string } = {},
): ValidateResult {
  const errors: FormErrors = {};

  if (!values.currentPassword) errors.currentPassword = 'Enter your current password.';

  const password = validatePassword(values.password, context);
  if (password) {
    errors.password = password;
  } else if (values.currentPassword && values.currentPassword === values.password) {
    errors.password = 'Your new password must be different from the current one.';
  }

  const confirm = validateConfirmation(values.confirmPassword, values.password);
  if (confirm) errors.confirmPassword = confirm;

  return Object.keys(errors).length ? fail(errors) : ok;
}

export interface ProfileValues {
  displayName: string;
}

export function validateProfile(values: ProfileValues): ValidateResult {
  const errors: FormErrors = {};
  const trimmed = values.displayName.trim();
  if (!trimmed) errors.displayName = 'Choose a display name.';
  else if (trimmed.length > 32) errors.displayName = 'Display name must be at most 32 characters.';
  return Object.keys(errors).length ? fail(errors) : ok;
}

/**
 * Accepts a verification or reset link and returns the token, or `null`.
 *
 * The value is capped at 200 characters to match the server schema before the
 * player is told anything; a longer string in the URL is a malformed or
 * tampered link, not a legitimate one.
 */
export function tokenFromUrlParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const token = value.trim();
  if (token.length < 20 || token.length > 200) return null;
  return token;
}

/** Longest display name the schema accepts, for the input's `maxLength`. */
export const DISPLAY_NAME_MAX = 32;
export { usernameLengthError, USERNAME_RE };

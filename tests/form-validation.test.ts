import { describe, expect, it } from 'vitest';
import {
  validateChangePassword,
  validateEmail,
  validateLogin,
  validatePassword,
  validateProfile,
  validateRegister,
  validateReset,
  validateUsername,
  tokenFromUrlParam,
} from '@/shared/form-validation';
import {
  DEFAULT_REDIRECT_AFTER_LOGIN,
  sanitizeNextPath,
} from '@/lib/navigation';

describe('open-redirect protection', () => {
  it('allows an ordinary same-origin path', () => {
    expect(sanitizeNextPath('/dashboard')).toBe('/dashboard');
    expect(sanitizeNextPath('/settings#sessions')).toBe('/settings#sessions');
    expect(sanitizeNextPath('/missions/networking.l1?tab=brief')).toBe(
      '/missions/networking.l1?tab=brief',
    );
  });

  it('refuses an absolute URL', () => {
    // The attack this blocks: `/login?next=https://evil.example` makes a
    // successful sign-in bounce the player to a page we do not control.
    for (const value of [
      'https://evil.example',
      'http://evil.example',
      'HTTPS://evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>',
    ]) {
      expect(sanitizeNextPath(value)).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    }
  });

  it('refuses a protocol-relative URL that looks like a path', () => {
    expect(sanitizeNextPath('//evil.example')).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    expect(sanitizeNextPath('//evil.example/path')).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
  });

  it('refuses backslash variants that some browsers normalise to //', () => {
    expect(sanitizeNextPath('/\\evil.example')).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    expect(sanitizeNextPath('\\\\evil.example')).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    expect(sanitizeNextPath('/dashboard\\..\\evil')).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
  });

  it('refuses a value containing a newline or control character', () => {
    // A raw newline in a Location header is a response-splitting primitive.
    expect(sanitizeNextPath('/dashboard\nSet-Cookie: a=b')).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    expect(sanitizeNextPath('/dashboard\r\nLocation: https://evil.example')).toBe(
      DEFAULT_REDIRECT_AFTER_LOGIN,
    );
    expect(sanitizeNextPath('/dashboard\u0000')).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
  });

  it('refuses an over-long value', () => {
    expect(sanitizeNextPath(`/${'a'.repeat(300)}`)).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
  });

  it('falls back for missing, empty, non-string and array input', () => {
    expect(sanitizeNextPath(undefined)).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    expect(sanitizeNextPath(null)).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    expect(sanitizeNextPath('')).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    expect(sanitizeNextPath('   ')).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    expect(sanitizeNextPath(42 as unknown as string)).toBe(DEFAULT_REDIRECT_AFTER_LOGIN);
    // A repeated param arrives as an array; only the first is considered.
    expect(sanitizeNextPath(['/dashboard', '//evil.example'])).toBe('/dashboard');
  });
});

describe('field validators', () => {
  it('names the missing field rather than saying "invalid"', () => {
    expect(validateUsername('')).toBe('Choose a callsign.');
    expect(validateEmail('')).toBe('Enter your email address.');
    expect(validatePassword('')).toBe('Choose a password.');
  });

  it('explains the callsign rule once, in full', () => {
    const message = validateUsername('A!');
    expect(message).toContain('3-20');
    expect(message).toContain('lowercase');
  });

  it('rejects a reserved callsign', () => {
    // The format rule runs first, so only handles that already satisfy it can
    // reach the reserved check; "Admin" is rejected as malformed, not reserved.
    for (const value of ['admin', '  root  ', 'cybergrid', 'mod', 'support']) {
      expect(validateUsername(value)).toBe('That callsign is reserved.');
    }
    expect(validateUsername('Admin')).toBe(
      'Use 3-20 lowercase letters, digits, "_" or "-", with no leading or trailing separator.',
    );
  });

  it('does not reserve a handle that merely starts with a reserved word', () => {
    // "admins" and "modem" are ordinary callsigns; a prefix match would be a
    // support ticket waiting to happen.
    expect(validateUsername('admins')).toBeUndefined();
    expect(validateUsername('modem')).toBeUndefined();
  });

  it('trims before validating, so padding cannot smuggle input through', () => {
    expect(validateUsername('  netrunner  ')).toBeUndefined();
    expect(validateEmail('  a@b.com ')).toBeUndefined();
  });

  it('rejects a malformed or over-long email', () => {
    for (const value of ['nope', 'a@b', 'a@@b.com', 'a b@c.com', `${'a'.repeat(250)}@b.com`]) {
      expect(validateEmail(value)).toBeTruthy();
    }
  });
});

describe('form rules', () => {
  const good = {
    username: 'netrunner',
    email: 'net@example.com',
    password: 'm7$qRv2!xLp9',
    confirmPassword: 'm7$qRv2!xLp9',
  };

  it('accepts a complete registration', () => {
    expect(validateRegister(good)).toEqual({ ok: true, errors: {} });
  });

  it('reports every problem at once rather than one at a time', () => {
    const result = validateRegister({
      username: '',
      email: 'bad',
      password: 'short',
      confirmPassword: 'different',
    });
    expect(result.ok).toBe(false);
    // Four bad fields produce four messages, so the form can render them together
    // instead of the player discovering them one submit at a time.
    expect(Object.keys(result.errors).sort()).toEqual([
      'confirmPassword',
      'email',
      'password',
      'username',
    ]);
  });

  it('reports a mismatch only against the confirmation field', () => {
    const result = validateRegister({ ...good, confirmPassword: 'm7$qRv2!xLp8' });
    expect(result.errors.password).toBeUndefined();
    expect(result.errors.confirmPassword).toBe('Passwords do not match.');
  });

  it('requires an identifier and a password to sign in', () => {
    expect(validateLogin({ identifier: '', password: 'x' }).errors.identifier).toBeTruthy();
    expect(validateLogin({ identifier: 'net', password: '' }).errors.password).toBeTruthy();
    expect(validateLogin({ identifier: 'net', password: 'x' }).ok).toBe(true);
  });

  it('applies personal-data rules to a reset without a known username', () => {
    // On the reset page the server knows the account; the client does not, so the
    // local check must not reject something the server would accept.
    expect(validateReset({ password: good.password, confirmPassword: good.password }).ok).toBe(true);
    expect(
      validateReset({ password: 'netrunner#2024', confirmPassword: 'netrunner#2024' }, {
        username: 'netrunner',
      }).errors.password,
    ).toContain('callsign');
  });

  it('refuses a change that reuses the current password', () => {
    const result = validateChangePassword({
      currentPassword: 'm7$qRv2!xLp9',
      password: 'm7$qRv2!xLp9',
      confirmPassword: 'm7$qRv2!xLp9',
    });
    expect(result.errors.password).toBe('Your new password must be different from the current one.');
  });

  it('requires the current password on a change', () => {
    const result = validateChangePassword({
      currentPassword: '',
      password: 'm7$qRv2!xLp9',
      confirmPassword: 'm7$qRv2!xLp9',
    });
    expect(result.errors.currentPassword).toBe('Enter your current password.');
    // A valid new password is not flagged just because the current one is empty.
    expect(result.errors.password).toBeUndefined();
  });

  it('bounds the display name', () => {
    expect(validateProfile({ displayName: '' }).errors.displayName).toBeTruthy();
    expect(validateProfile({ displayName: '   ' }).errors.displayName).toBeTruthy();
    expect(validateProfile({ displayName: 'a'.repeat(33) }).errors.displayName).toContain('32');
    expect(validateProfile({ displayName: 'Net Runner' }).ok).toBe(true);
  });
});

describe('token from URL', () => {
  const token = 'a'.repeat(43);

  it('accepts a well-formed token', () => {
    expect(tokenFromUrlParam(token)).toBe(token);
  });

  it('trims surrounding whitespace', () => {
    expect(tokenFromUrlParam(`  ${token}  `)).toBe(token);
  });

  it('rejects a token outside the length bounds the server enforces', () => {
    expect(tokenFromUrlParam(undefined)).toBeNull();
    expect(tokenFromUrlParam('')).toBeNull();
    expect(tokenFromUrlParam('a'.repeat(19))).toBeNull();
    expect(tokenFromUrlParam('a'.repeat(201))).toBeNull();
  });

  it('takes only the first value of a repeated param', () => {
    expect(tokenFromUrlParam([token, 'b'.repeat(43)])).toBe(token);
  });
});

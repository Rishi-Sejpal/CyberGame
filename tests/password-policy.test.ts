import { describe, expect, it } from 'vitest';
import {
  PASSWORD_POLICY,
  checkPasswordPolicy,
  passwordIssueMessage,
  passwordPolicyMessage,
  scorePassword,
  strengthColor,
  type StrengthLabel,
} from '@/shared/password-policy';
import {
  RESERVED_USERNAMES,
  USERNAME_RE,
  isReservedUsername,
  usernameLengthError,
} from '@/shared/identity-rules';

describe('password policy', () => {
  it('accepts a long password with all four classes', () => {
    const result = checkPasswordPolicy('Tr0ub4dor&3xyz!');
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('reports length before class composition', () => {
    // A 6-character password is missing every class, but telling the player all
    // of that is noise: the length is the only thing worth saying first.
    const result = checkPasswordPolicy('aA1!aa');
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toBe(`too_short_min_${PASSWORD_POLICY.minLength}`);
    expect(passwordPolicyMessage(result.issues)).toBe(
      `Password must be at least ${PASSWORD_POLICY.minLength} characters.`,
    );
  });

  it('rejects an over-long password without leaking other issues first', () => {
    const long = 'aA1!'.repeat(60); // 240 chars
    const result = checkPasswordPolicy(long);
    expect(result.ok).toBe(false);
    expect(passwordPolicyMessage(result.issues)).toBe(
      `Password must be at most ${PASSWORD_POLICY.maxLength} characters.`,
    );
  });

  it('rejects the credential list case-insensitively', () => {
    for (const candidate of ['password', 'PassWord', 'abc123', 'letmein']) {
      expect(checkPasswordPolicy(candidate.padEnd(12, 'x')).issues).toContain('too_common');
    }
  });

  it('rejects a common credential carrying a suffix, a prefix or a leet swap', () => {
    // These are the strings an attacker tries before anything in this app is
    // interesting. A list checked with exact equality misses every one of them.
    for (const candidate of [
      'Password123!',
      'PASSWORD123!',
      'mypassword1',
      'p@ssw0rd!',
      'Pa55w0rd!',
    ]) {
      expect(checkPasswordPolicy(candidate).issues).toContain('too_common');
    }
  });

  it('does not reject a passphrase that merely contains a short word', () => {
    // "cat" is far too short to substring-match on; rejecting "catalog1!A2" would
    // be indefensible.
    expect(checkPasswordPolicy('catalog1!A2b').issues).not.toContain('too_common');
  });

  it('blocks the personal-data guesses', () => {
    expect(checkPasswordPolicy('Netrunner#2024x', { username: 'netrunner' }).issues).toContain(
      'contains_username',
    );
    expect(checkPasswordPolicy('Alice#secure99', { email: 'alice@example.com' }).issues).toContain(
      'contains_email',
    );
  });

  it('only applies the personal-data rules at 3+ characters', () => {
    // A one-character username must not make every password fail.
    expect(checkPasswordPolicy('Ab1!efghijkl', { username: 'a' }).ok).toBe(true);
    expect(checkPasswordPolicy('Ab1!efghijkl', { email: 'a@b.co' }).ok).toBe(true);
  });

  it('summarises class issues into one sentence', () => {
    const result = checkPasswordPolicy('abcdefghijkl');
    const message = passwordPolicyMessage(result.issues);
    expect(message).toContain('Add an uppercase letter.');
    expect(message).toContain('Add a digit.');
    expect(message).toContain('Add a symbol');
    // The "at least three of" summary is emitted alongside the per-class advice,
    // so the four class names legitimately appear in the message.
    expect(message).toContain('at least three of');
  });

  it('de-duplicates repeated issues', () => {
    // `a` appears in both the username and the email context.
    const result = checkPasswordPolicy('aaaaaaa', { username: 'aaaaaaa' });
    expect(new Set(result.issues).size).toBe(result.issues.length);
  });

  it('has a message for every issue code it can emit', () => {
    for (const issue of [
      'needs_lowercase',
      'needs_uppercase',
      'needs_digit',
      'needs_symbol',
      'needs_three_classes',
      'too_common',
      'contains_username',
      'contains_email',
    ] as const) {
      expect(passwordIssueMessage(issue)).toBeTruthy();
    }
    expect(passwordIssueMessage(`too_short_min_${PASSWORD_POLICY.minLength}`)).toContain('12');
  });

  it('returns an empty message for a clean password', () => {
    expect(passwordPolicyMessage([])).toBe('');
  });
});

describe('strength meter', () => {
  it('is empty for an empty string', () => {
    const strength = scorePassword('');
    expect(strength).toEqual({ score: 0, label: 'empty', acceptable: false, hint: '' });
  });

  it('reports the length rule before anything else', () => {
    expect(scorePassword('aA1!').label).toBe('very-weak');
    expect(scorePassword('aA1!').hint).toContain('at least 12');
  });

  it('rejects a keyboard walk outright when it is also a known credential', () => {
    const walk = scorePassword('qwertyuiop1!A');
    expect(walk.acceptable).toBe(false);
    expect(walk.score).toBe(0);
  });

  it('penalises a walk that is not in the credential list', () => {
    // Same length and same character classes as the strong password below, so
    // the only difference the meter can be reacting to is the key pattern.
    const walk = scorePassword('asdfjkl;zxcv1!A');
    const strong = scorePassword('m7$qRv2!xLp9#w');
    expect(strong.score).toBe(4);
    expect(walk.score).toBeLessThan(strong.score);
    expect(walk.score).toBeLessThanOrEqual(2);
  });

  it('catches a walk broken up by separators and typed backwards', () => {
    for (const value of ['qwe-rty!A1b', 'Zxcv!Bnm2Qz', 'asdf_jkl!9Qa']) {
      expect(scorePassword(value).score).toBeLessThan(4);
    }
  });

  it('floors a password that reuses the username', () => {
    const strength = scorePassword('netrunner#2024', { username: 'netrunner' });
    expect(strength.score).toBe(0);
    expect(strength.acceptable).toBe(false);
  });

  it('reaches strong on a long, varied, non-patterned password', () => {
    const strength = scorePassword('m7$qRv2!xLp9#wKd4&z');
    expect(strength.acceptable).toBe(true);
    expect(strength.label).toBe('strong');
    expect(strength.hint).toBe('');
  });

  it('is monotonic in length for otherwise identical input', () => {
    const short = scorePassword('m7$qRv2!');
    const long = scorePassword('m7$qRv2!xLp9');
    expect(long.score).toBeGreaterThanOrEqual(short.score);
  });

  it('maps every label to a colour class', () => {
    for (const label of ['empty', 'very-weak', 'weak', 'fair', 'good', 'strong'] as const) {
      expect(strengthColor(label)).toMatch(/^bg-/);
    }
    // Distinct colours, so the bar is not readable by tone alone as one colour.
    const graded: Exclude<StrengthLabel, 'empty'>[] = [
      'very-weak',
      'weak',
      'fair',
      'good',
      'strong',
    ];
    expect(new Set(graded.map(strengthColor)).size).toBe(graded.length);
  });
});

describe('identity rules', () => {
  it('matches valid callsigns', () => {
    for (const value of ['abc', 'a1b', 'net_runner', 'net-runner', 'a'.repeat(20), 'a1_2-3']) {
      expect(USERNAME_RE.test(value)).toBe(true);
    }
  });

  it('rejects malformed callsigns', () => {
    for (const value of [
      'ab',
      'a'.repeat(21),
      '_abc',
      'abc_',
      '-abc',
      'abc-',
      'Abc',
      'a b',
      'a.b',
      'a@b',
    ]) {
      expect(USERNAME_RE.test(value)).toBe(false);
    }
  });

  it('reserves the impersonating handles case-insensitively', () => {
    for (const value of ['admin', 'ADMIN', '  Admin  ', 'CyberGrid', 'ROOT', 'Mod']) {
      expect(isReservedUsername(value)).toBe(true);
    }
    for (const value of ['netrunner', 'admins', 'modem', 'nulled', 'rootkit']) {
      expect(isReservedUsername(value)).toBe(false);
    }
  });

  it('keeps the exported set in the folded form its helper assumes', () => {
    // The set is a raw data structure; a future edit that adds "Admin" would
    // silently stop matching. This fails loudly instead.
    for (const entry of RESERVED_USERNAMES) {
      expect(entry).toBe(entry.toLowerCase());
      expect(isReservedUsername(entry)).toBe(true);
    }
  });

  it('describes the length boundaries', () => {
    expect(usernameLengthError(2)).toContain('at least 3');
    expect(usernameLengthError(21)).toContain('at most 20');
    expect(usernameLengthError(10)).toBeUndefined();
  });
});

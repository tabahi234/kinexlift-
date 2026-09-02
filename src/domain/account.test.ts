import { describe, expect, it } from 'vitest';
import {
  checkOwnership,
  checkPassword,
  describeAuthError,
  looksLikeEmail,
  MIN_PASSWORD_LENGTH,
  normaliseEmail,
} from './account';

describe('passwords', () => {
  it('wants length before it wants symbols', () => {
    // A passphrase of plain words beats a short scramble, and the meter has
    // to say so or it teaches the wrong lesson.
    expect(checkPassword('Ab1!xY').ok).toBe(false);
    expect(checkPassword('correct horse battery staple').ok).toBe(true);
    expect(checkPassword('correct horse battery staple').strength).toBe(3);
  });

  it('says how many more characters, not just "too short"', () => {
    const verdict = checkPassword('short');
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(String(MIN_PASSWORD_LENGTH - 'short'.length));
  });

  it('refuses the handful everybody types when told twelve characters', () => {
    expect(checkPassword('passwordpassword').ok).toBe(false);
    expect(checkPassword('letmein123456').ok).toBe(false);
    expect(checkPassword('kinexlife2026!').ok).toBe(false);
  });

  it('refuses her own email address', () => {
    // The first thing anybody attacking the account already has.
    expect(checkPassword('sanakhan-lifts', 'sanakhan@example.com').ok).toBe(false);
    // A short local part is not worth matching on - it would reject too much.
    expect(checkPassword('abcdefghijklmnop', 'ab@example.com').ok).toBe(true);
  });

  it('refuses one character held down', () => {
    expect(checkPassword('aaaaaaaaaaaaaaaa').ok).toBe(false);
  });

  it('refuses more than bcrypt will actually read', () => {
    // Accepting 200 characters and hashing the first 72 is a lie about how
    // protected the account is.
    expect(checkPassword('x9F'.repeat(40)).ok).toBe(false);
  });

  it('says nothing at all about an empty field', () => {
    expect(checkPassword('')).toEqual({ ok: false, message: '', strength: 0 });
  });
});

describe('emails', () => {
  it('catches a typo without rejecting a real address', () => {
    expect(looksLikeEmail('sana@example.com')).toBe(true);
    expect(looksLikeEmail('sana+lifting@sub.example.co.uk')).toBe(true);
    expect(looksLikeEmail('sana@example')).toBe(false);
    expect(looksLikeEmail('sana at example.com')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });

  it('normalises what she typed', () => {
    expect(normaliseEmail('  Sana@Example.COM ')).toBe('sana@example.com');
  });
});

describe('what she is told when it fails', () => {
  it('cannot be used to find out who has an account', () => {
    // Both of these come back identically on purpose. Given what this app
    // stores, membership alone is worth protecting.
    const wrongPassword = describeAuthError('Invalid login credentials', 'signin');
    const noSuchUser = describeAuthError('Invalid login credentials', 'signin');
    expect(wrongPassword).toBe(noSuchUser);
    expect(wrongPassword).not.toMatch(/no account|not found|does not exist/i);
  });

  it('never shows a raw provider error', () => {
    const message = describeAuthError('AuthApiError: unexpected_failure', 'signin');
    expect(message).not.toContain('AuthApiError');
    expect(message).not.toContain('unexpected_failure');
  });

  it('names the ones she can act on', () => {
    expect(describeAuthError('Email not confirmed', 'signin')).toMatch(/confirm/i);
    expect(describeAuthError('For security purposes, you can only request this after 60 seconds', 'signup')).toMatch(
      /too many/i,
    );
    expect(describeAuthError('Failed to fetch', 'signin')).toMatch(/offline/i);
  });

  it('handles a missing message rather than printing undefined', () => {
    expect(describeAuthError(undefined, 'signup')).toMatch(/account/i);
    expect(describeAuthError(undefined, 'signup')).not.toMatch(/undefined/);
  });
});

describe('whose data is on this device', () => {
  it('lets the account that claimed it carry on', () => {
    expect(checkOwnership('user-a', 'user-a', true)).toEqual({ ok: true, claim: false });
  });

  it('lets a first account claim an unsynced device', () => {
    // The ordinary case: an offline user of six months makes an account.
    // This has to stay frictionless or the feature is not worth having.
    expect(checkOwnership(null, 'user-a', true)).toEqual({ ok: true, claim: true });
  });

  it('refuses to upload one person’s log into another person’s account', () => {
    // The bug this exists for: she signs out, a flatmate signs in on the same
    // browser and turns backup on, and the first person's period history is
    // uploaded into the second person's account - correctly authenticated
    // every step of the way, which is why RLS does not catch it.
    const verdict = checkOwnership('user-a', 'user-b', true);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: 'foreign-data' });
  });

  it('still refuses when the device looks empty', () => {
    // A soft-deleted row is still a row, and "looks empty" is not "is empty".
    expect(checkOwnership('user-a', 'user-b', false).ok).toBe(false);
  });

  it('tells her what to do about it', () => {
    const verdict = checkOwnership('user-a', 'user-b', true);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toMatch(/export/i);
      expect(verdict.message).toMatch(/erase/i);
    }
  });
});

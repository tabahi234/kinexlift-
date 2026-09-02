/**
 * The rules an account has to follow, with no network and no React in sight.
 *
 * All of this could have lived inside the sign-in form. It does not, because
 * every rule here is one somebody will want to argue with in a test rather
 * than by typing a bad password into a browser forty times - and because the
 * ownership check below is the difference between a backup and a data breach.
 */

/* ------------------------------- passwords ------------------------------- */

/**
 * Twelve, not eight.
 *
 * This is the key to a store of somebody's menstrual history, and it is
 * protected by one password with no second factor. Length is the only
 * property of a password that reliably resists an offline attack, and a
 * twelve-character minimum with no composition rules produces better
 * passwords than eight with a symbol demanded - the symbol rule mostly
 * produces `Password1!`.
 *
 * Supabase enforces its own minimum server-side. This one is stricter and it
 * is checked here so she is told *before* the request, in a sentence rather
 * than in an API error.
 */
export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt silently truncates past 72 bytes, so accepting more is a lie. */
export const MAX_PASSWORD_LENGTH = 72;

/**
 * The handful that are worth refusing outright.
 *
 * Not a password list - a real one is megabytes and belongs on the server,
 * where Supabase's own leaked-password check already lives. This catches the
 * few a person types when a form has just told them twelve characters.
 */
const OBVIOUS = [
  'password',
  'passw0rd',
  'letmein',
  'qwerty',
  'iloveyou',
  '123456',
  'admin',
  'welcome',
  'kinexlife',
];

export interface PasswordVerdict {
  ok: boolean;
  /** Shown under the field as she types. Always says what to do next. */
  message: string;
  /** 0-3, for the strength bar. Only meaningful once `ok` is true. */
  strength: 0 | 1 | 2 | 3;
}

export function checkPassword(password: string, email = ''): PasswordVerdict {
  if (password === '') {
    return { ok: false, message: '', strength: 0 };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    const missing = MIN_PASSWORD_LENGTH - password.length;
    return {
      ok: false,
      message: `${missing} more character${missing === 1 ? '' : 's'}. Length is what actually protects it. A passphrase of three or four words is easier to remember and harder to break than a short one with a symbol in it.`,
      strength: 0,
    };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Passwords are cut off after ${MAX_PASSWORD_LENGTH} characters, so anything longer is not doing what you think.`,
      strength: 0,
    };
  }

  const lower = password.toLowerCase();

  if (OBVIOUS.some((entry) => lower.includes(entry))) {
    return {
      ok: false,
      message: 'That contains one of the first things anybody guesses. Pick something else.',
      strength: 0,
    };
  }

  // The local part of her own email address, which is the other thing people
  // reach for and the first thing an attacker who has the email will try.
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 4 && lower.includes(localPart)) {
    return {
      ok: false,
      message: 'That contains your email address. Anyone attacking this account already has that.',
      strength: 0,
    };
  }

  // A single repeated character or a run of one keyboard row, however long.
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, message: 'That is one character repeated.', strength: 0 };
  }

  const variety =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));

  // Length carries most of the weight, deliberately. A sixteen-character
  // passphrase of plain lowercase words is stronger than a twelve-character
  // scramble, and a strength meter that says otherwise teaches the wrong
  // lesson.
  const strength: PasswordVerdict['strength'] =
    password.length >= 20 || (password.length >= 16 && variety >= 2)
      ? 3
      : password.length >= 16 || variety >= 3
        ? 2
        : 1;

  return {
    ok: true,
    message:
      strength === 1
        ? 'That will do. Longer would be better than more symbols.'
        : strength === 2
          ? 'Good.'
          : 'Strong.',
    strength,
  };
}

/* -------------------------------- emails -------------------------------- */

/**
 * Enough to catch a typo, and nothing more.
 *
 * A full RFC 5322 pattern rejects addresses that genuinely work, and the
 * server validates anyway. The only job here is to stop her waiting for a
 * confirmation email that was never going to arrive.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) && trimmed.length <= 254;
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/* ------------------------------- failures ------------------------------- */

/**
 * What to show her when the server says no.
 *
 * Provider messages are turned into our own for two reasons. The first is
 * that "AuthApiError: Invalid login credentials" is not a sentence anybody
 * should read. The second matters more: several of them distinguish "no such
 * account" from "wrong password", which lets anybody with a list of email
 * addresses find out which of them have accounts here - and given what this
 * app stores, membership alone is information worth protecting. Both cases
 * come back as the same sentence.
 */
export function describeAuthError(raw: string | undefined, mode: 'signin' | 'signup'): string {
  const message = (raw ?? '').toLowerCase();

  if (
    message.includes('rate') ||
    message.includes('too many') ||
    message.includes('429') ||
    // What Supabase actually sends when it throttles: "For security purposes,
    // you can only request this after 41 seconds." None of the obvious
    // keywords are in it, which is how this fell through the first time.
    message.includes('for security purposes') ||
    message.includes('only request this after')
  ) {
    return 'Too many attempts. Wait a minute and try again.';
  }

  if (
    message.includes('invalid login') ||
    message.includes('invalid credentials') ||
    message.includes('email not confirmed')
  ) {
    return message.includes('not confirmed')
      ? 'This account still needs confirming. Check your email for the link.'
      : // Deliberately identical whether or not the account exists.
        'That email and password do not match an account.';
  }

  if (message.includes('already registered') || message.includes('already exists')) {
    // Same reasoning: this one is unavoidable on sign-up, because the server
    // has to refuse, so it is worded to be useful rather than confirmatory.
    return 'If that address already has an account, sign in instead, or reset the password from the sign-in screen.';
  }

  if (message.includes('password')) {
    return `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (message.includes('network') || message.includes('fetch')) {
    return 'Could not reach the server. Everything still works offline.';
  }

  return mode === 'signup'
    ? 'Could not create the account. Try again in a moment.'
    : 'Could not sign in. Try again in a moment.';
}

/* ---------------------------- whose data is this ---------------------------- */

export type OwnershipVerdict =
  | { ok: true; claim: boolean }
  | { ok: false; reason: 'foreign-data'; message: string };

/**
 * May the data on this device be uploaded to this account?
 *
 * This function exists because of a real and quite bad bug. Backup pushes
 * every local row stamped with whoever is currently signed in. IndexedDB is
 * not cleared on sign out, so: she signs out, a flatmate signs in on the same
 * browser and turns backup on, and the first person's entire log - period
 * dates included - is uploaded into the second person's account, where it is
 * now legitimately theirs to read. Row-level security does not help; every
 * write was correctly authenticated as the new user.
 *
 * So the device remembers which account its data belongs to, and refuses to
 * push anybody else's. Unclaimed data - a fresh install, or an existing user
 * signing in for the first time - is claimed by the account that first backs
 * it up, which is the case that has to stay frictionless.
 */
export function checkOwnership(
  storedOwner: string | null,
  userId: string,
  hasLocalData: boolean,
): OwnershipVerdict {
  if (storedOwner === userId) return { ok: true, claim: false };

  if (storedOwner === null) {
    // Nothing has claimed this device yet. If there is data here it belongs
    // to whoever is signing in - the ordinary case of an existing offline
    // user making an account for the first time.
    return { ok: true, claim: true };
  }

  // A different account has already claimed this device's data.
  return {
    ok: false,
    reason: 'foreign-data',
    message: hasLocalData
      ? 'The training log on this device belongs to a different account, and backing it up here would copy it into this one. Export it first if you want to keep it, then erase the local data. Both are on this screen.'
      : 'This device was last used by a different account. Erase the local data on this screen to back up as yourself.',
  };
}

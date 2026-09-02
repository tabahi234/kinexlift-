import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import {
  checkPassword,
  describeAuthError,
  looksLikeEmail,
  normaliseEmail,
} from '../domain/account';

/**
 * Accounts, for the optional cloud backup.
 *
 * Everything that decides anything lives in domain/account.ts, where it can be
 * tested without a network. This file is the plumbing: it calls Supabase, and
 * it makes sure nothing the provider says reaches her unedited.
 *
 * That last part is not cosmetic. Supabase distinguishes "no such account"
 * from "wrong password", and passing that through would let anyone with a list
 * of email addresses find out which of them have accounts here. For an app
 * holding menstrual data, membership alone is worth protecting.
 */

export type AuthResult =
  | { ok: true; needsConfirmation: boolean }
  | { ok: false; message: string };

/**
 * Creating an account.
 *
 * `needsConfirmation` is the case worth getting right. With email
 * confirmation on - which it should be - `signUp` returns a user and **no
 * session**, because the address has not been proved yet. The first version of
 * this screen said "Account created! You can now sync your data", which was
 * wrong twice over: nothing was synced, and nothing could be until she
 * clicked a link she had not been told to look for.
 */
export async function signUp(email: string, password: string): Promise<AuthResult> {
  const address = normaliseEmail(email);

  if (!looksLikeEmail(address)) {
    return { ok: false, message: 'That does not look like an email address.' };
  }

  // Checked here as well as in the form, because a form is a suggestion and
  // this is the last point before a weak password becomes a real account.
  const verdict = checkPassword(password, address);
  if (!verdict.ok) {
    return { ok: false, message: verdict.message };
  }

  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({ email: address, password });

  if (error) return { ok: false, message: describeAuthError(error.message, 'signup') };

  return { ok: true, needsConfirmation: data.session === null };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const address = normaliseEmail(email);

  if (!looksLikeEmail(address) || password === '') {
    // Deliberately the same sentence a wrong password gets. Telling her the
    // address is malformed is harmless; telling her it is unregistered is not.
    return { ok: false, message: 'That email and password do not match an account.' };
  }

  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: address,
    password,
  });

  if (error) return { ok: false, message: describeAuthError(error.message, 'signin') };
  return { ok: true, needsConfirmation: false };
}

/**
 * A password reset link.
 *
 * Always reports success, whether or not the address has an account. The
 * alternative is a form that answers "does this person use a period-tracking
 * app" to anybody who asks.
 */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const address = normaliseEmail(email);
  if (!looksLikeEmail(address)) {
    return { ok: false, message: 'That does not look like an email address.' };
  }

  const supabase = await getSupabase();
  await supabase.auth.resetPasswordForEmail(address, {
    redirectTo: window.location.origin,
  });

  return { ok: true, needsConfirmation: true };
}

/**
 * Signing out.
 *
 * The local database is deliberately left alone. Her log is hers, it works
 * offline, and wiping it because she signed out would be the app deleting
 * months of training to tidy up. What stops the next person to sign in on this
 * browser from uploading it into their account is the ownership marker in
 * lib/sync.ts, not this function - see `checkOwnership`.
 */
export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  await supabase.auth.signOut();
}

export async function updatePassword(password: string): Promise<AuthResult> {
  const verdict = checkPassword(password, '');
  if (!verdict.ok) {
    return { ok: false, message: verdict.message };
  }

  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { ok: false, message: describeAuthError(error.message, 'signin') };
  }

  return { ok: true, needsConfirmation: false };
}

export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    void getSupabase().then((supabase) => {
      void supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setLoading(false);
      });

      const { data } = supabase.auth.onAuthStateChange((_event, next) => {
        if (mounted) setSession(next);
      });
      subscription = data.subscription;
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  return { session, loading };
}

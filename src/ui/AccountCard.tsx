import { useState } from 'react';
import { useToast } from './ToastProvider';
import { requestPasswordReset, signIn, signOut, signUp, useSession } from '../lib/auth';
import { checkPassword, looksLikeEmail, MIN_PASSWORD_LENGTH } from '../domain/account';
import { IconCheck } from './icons';

/**
 * Signing in, for the optional backup.
 *
 * The previous version of this was a bare email and password box with a six
 * character minimum and inline styles, and it got three things wrong that all
 * matter more here than they would in most apps - this is the front door to a
 * store of somebody's menstrual history.
 *
 *   - It told her "Account created! You can now sync your data" when email
 *     confirmation is on, which is the default and should be. There was no
 *     session, nothing could sync, and she had not been told to look for a
 *     link. Now the screen changes to say exactly that.
 *   - It printed whatever Supabase said, including messages that distinguish
 *     "no such account" from "wrong password". That turns the form into a
 *     lookup service for who has an account here.
 *   - It had no way to reset a password, so a forgotten one meant the backup
 *     was gone.
 *
 * The password rules and the wording all live in domain/account.ts.
 */

type Mode = 'signin' | 'signup' | 'reset';

const TITLE: Record<Mode, string> = {
  signin: 'Sign in',
  signup: 'Create an account',
  reset: 'Reset your password',
};

export function AccountCard() {
  const { session, loading } = useSession();
  const { showToast } = useToast();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  /** Shown in place of the form once there is an email to go and open. */
  const [sent, setSent] = useState<'confirm' | 'reset' | null>(null);

  if (loading) {
    return <p className="loading-note">Checking your account…</p>;
  }

  if (session) {
    return (
      <div className="account-box signed-in">
        <span className="account-who">
          <IconCheck size={16} />
          <span>
            Signed in as <strong>{session.user.email}</strong>
          </span>
        </span>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await signOut();
            setBusy(false);
            // Said out loud because it is the question anybody asks next, and
            // the answer is the reassuring one.
            showToast('Signed out. Your training log is still on this device.', 'ok');
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="account-box">
        <p className="account-sent">
          {sent === 'confirm'
            ? 'Check your email and open the link to confirm the address. Backup starts working once you have.'
            : 'If that address has an account, a reset link is on its way to it.'}
        </p>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setSent(null);
            setMode('signin');
          }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  const verdict = checkPassword(password, email);
  const emailOk = looksLikeEmail(email);
  const canSubmit =
    !busy && emailOk && (mode === 'reset' || (mode === 'signin' ? password !== '' : verdict.ok));

  async function submit() {
    setBusy(true);

    const result =
      mode === 'signup'
        ? await signUp(email, password)
        : mode === 'reset'
          ? await requestPasswordReset(email)
          : await signIn(email, password);

    setBusy(false);

    if (!result.ok) {
      showToast(result.message, 'error');
      return;
    }

    setPassword('');

    if (mode === 'reset') {
      setSent('reset');
      return;
    }

    if (result.needsConfirmation) {
      setSent('confirm');
      return;
    }

    showToast(
      mode === 'signup' ? 'Account created. Backup is ready.' : 'Signed in.',
      'ok',
    );
  }

  return (
    <div className="account-box">
      <h3 className="account-title">{TITLE[mode]}</h3>

      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <label className="text-field">
          <span className="number-label">Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            disabled={busy}
            placeholder="you@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        {mode !== 'reset' && (
          <label className="text-field">
            <span className="number-label">Password</span>
            <input
              type="password"
              /* Tells a password manager to offer a generated one on sign-up
                 and the saved one on sign-in. Getting this wrong is why so
                 many people end up typing a password they can remember. */
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}

        {/* Only on sign-up. Grading a password she chose months ago, on the
            way in, is noise she can do nothing about. */}
        {mode === 'signup' && password !== '' && (
          <div className="password-meter">
            <span
              className={`meter-fill s${verdict.ok ? verdict.strength : 0}`}
              aria-hidden="true"
            />
            <span className={`meter-text ${verdict.ok ? 'ok' : ''}`}>
              {verdict.message}
            </span>
          </div>
        )}

        {mode === 'signup' && password === '' && (
          <p className="fineprint">
            At least {MIN_PASSWORD_LENGTH} characters. A few ordinary words in a
            row beats a short one with a symbol in it.
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
          {busy
            ? 'Working…'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'reset'
                ? 'Send a reset link'
                : 'Sign in'}
        </button>
      </form>

      <div className="account-switch">
        {mode === 'signin' && (
          <>
            <button type="button" className="link-btn" onClick={() => setMode('signup')}>
              Create an account
            </button>
            <button type="button" className="link-btn" onClick={() => setMode('reset')}>
              Forgotten your password?
            </button>
          </>
        )}
        {mode !== 'signin' && (
          <button type="button" className="link-btn" onClick={() => setMode('signin')}>
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

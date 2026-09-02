import { useState } from 'react';
import { updatePassword } from '../lib/auth';
import { checkPassword, MIN_PASSWORD_LENGTH } from '../domain/account';
import { useToast } from './ToastProvider';

export function PasswordRecovery({ onDone }: { onDone: () => void }) {
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const verdict = checkPassword(password, '');
  const canSubmit = !busy && password !== '' && verdict.ok;

  async function submit() {
    setBusy(true);
    const result = await updatePassword(password);
    setBusy(false);

    if (!result.ok) {
      showToast(result.message, 'error');
      return;
    }

    showToast('Password updated successfully.', 'ok');
    onDone();
  }

  return (
    <div className="onboarding">
      <div className="onboarding-body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="welcome-screen">
          <h1 className="welcome-name">Reset Password</h1>
          <p className="welcome-tagline">Choose a new password for your account.</p>
        </div>
        
        <div className="account-box" style={{ maxWidth: '400px', margin: '0 auto', width: '100%', marginTop: '2rem' }}>
          <form
            className="account-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void submit();
            }}
          >
            <label className="text-field">
              <span className="number-label">New Password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {password !== '' && (
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

            {password === '' && (
              <p className="fineprint">
                At least {MIN_PASSWORD_LENGTH} characters. A few ordinary words in a
                row beats a short one with a symbol in it.
              </p>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
              {busy ? 'Working…' : 'Update password'}
            </button>
            <button 
              type="button" 
              className="btn btn-quiet btn-block" 
              onClick={onDone}
              style={{ marginTop: '1rem' }}
            >
              Cancel
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

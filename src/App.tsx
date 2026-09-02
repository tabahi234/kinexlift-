import { useCallback, useState, useEffect, type ReactElement } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { syncNow } from './lib/sync';
import { useToast } from './ui/ToastProvider';
import { getProfile } from './db/repo';
import { cloudSyncEnabled } from './domain/profile';
import { Onboarding } from './ui/onboarding/Onboarding';
import { SessionScreen } from './ui/session/SessionScreen';
import { FuelScreen } from './ui/fuel/FuelScreen';
import { CoachScreen } from './ui/coach/CoachScreen';
import { ProgressScreen } from './ui/progress/ProgressScreen';
import { YouScreen } from './ui/YouScreen';
import { NavProvider, type View } from './ui/nav';
import { PasswordRecovery } from './ui/PasswordRecovery';
import {
  IconBowl,
  IconChart,
  IconChat,
  IconDumbbell,
  IconUser,
  type IconProps,
} from './ui/icons';

/**
 * Five destinations, and each one is a noun she would use herself.
 *
 * Everything she does daily is one tap from anywhere: today's session, what to
 * eat, and a coach that has already read the log. Cycle tracking lives inside
 * Progress rather than taking a sixth tab, because it is something she looks
 * at weekly, not hourly - and because a permanent tab for it on a phone she
 * might hand to someone else is a decision that should be hers.
 */
const TABS: { id: View; label: string; Icon: (props: IconProps) => ReactElement }[] = [
  { id: 'today', label: 'Today', Icon: IconDumbbell },
  { id: 'fuel', label: 'Fuel', Icon: IconBowl },
  { id: 'coach', label: 'Coach', Icon: IconChat },
  { id: 'progress', label: 'Progress', Icon: IconChart },
  { id: 'you', label: 'You', Icon: IconUser },
];

export function App() {
  const { showToast } = useToast();
  const [view, setView] = useState<View>('today');
  /**
   * What the screen she is being sent to should open when she lands on it.
   *
   * A one-shot: the destination reads it, acts, and clears it. Anything more
   * persistent would re-open the same panel every time she came back to the
   * tab, which is the kind of helpfulness that feels like being nagged.
   */
  const [focus, setFocus] = useState<string | null>(null);
  const profile = useLiveQuery(() => getProfile(), []);

  const go = useCallback((next: View, nextFocus?: string) => {
    setView(next);
    setFocus(nextFocus ?? null);
    window.scrollTo({ top: 0 });
  }, []);

  const clearFocus = useCallback(() => setFocus(null), []);

  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#')) {
      const params = new URLSearchParams(hash.substring(1));
      
      const errorMsg = params.get('error_description') || params.get('error');
      if (errorMsg) {
        showToast(errorMsg.replace(/\+/g, ' '), 'error');
        window.history.replaceState(null, '', window.location.pathname);
      } else if (params.get('type') === 'recovery') {
        setRecoveryMode(true);
        // Load Supabase so it can parse the access_token from the hash
        // before we clear it. It needs the token to allow the password update.
        import('./lib/supabase').then(({ getSupabase }) => {
          getSupabase().then(() => {
            // Give it a tiny moment to process the hash synchronously
            setTimeout(() => {
              window.history.replaceState(null, '', window.location.pathname);
            }, 100);
          });
        });
      }
    }
  }, [showToast]);

  const backupOn = profile ? cloudSyncEnabled(profile) : false;

  /**
   * Backup runs on launch and on reconnect - but only once she has turned it
   * on. The first version of this fired unconditionally, which uploaded her
   * period history on app start and made the onboarding screen's promise that
   * nothing is uploaded untrue.
   */
  useEffect(() => {
    if (!backupOn) return;

    const runSync = async () => {
      const outcome = await syncNow();
      if (!outcome.ok && outcome.reason === 'auth') {
        showToast('Please check your connection or restart the app to log in.', 'error');
      } else if (!outcome.ok && outcome.reason === 'error') {
        showToast('Background sync failed: ' + outcome.message, 'warn');
      }
    };

    void runSync();
    const handleOnline = () => void runSync();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [backupOn, showToast]);

  // Undefined means the query has not resolved yet - not that there is no
  // profile. Rendering onboarding here would flash it on every cold start.
  if (profile === undefined) {
    return <div className="app" />;
  }

  if (recoveryMode) {
    return (
      <div className="app">
        <PasswordRecovery onDone={() => setRecoveryMode(false)} />
      </div>
    );
  }

  if (!profile || profile.onboardedAt === null) {
    return (
      <div className="app">
        <Onboarding onDone={() => setView('today')} />
      </div>
    );
  }

  return (
    <NavProvider value={{ view, go, focus, clearFocus }}>
      <div className="app">
        {view === 'today' && <SessionScreen />}
        {view === 'fuel' && <FuelScreen />}
        {view === 'coach' && <CoachScreen />}
        {view === 'progress' && <ProgressScreen />}
        {view === 'you' && <YouScreen />}
      </div>

      <nav className="bottom-nav" aria-label="Sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`nav-item ${view === tab.id ? 'active' : ''}`}
            aria-current={view === tab.id ? 'page' : undefined}
            onClick={() => go(tab.id)}
          >
            <tab.Icon size={21} />
            {tab.label}
          </button>
        ))}
      </nav>
    </NavProvider>
  );
}

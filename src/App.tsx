import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getProfile } from './db/repo';
import { Onboarding } from './ui/onboarding/Onboarding';
import { SessionScreen } from './ui/session/SessionScreen';
import { ProgressScreen } from './ui/progress/ProgressScreen';
import { YouScreen } from './ui/YouScreen';

type View = 'today' | 'progress' | 'you';

const TABS: { id: View; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '🏋️' },
  { id: 'progress', label: 'Progress', icon: '📈' },
  { id: 'you', label: 'You', icon: '👤' },
];

export function App() {
  const [view, setView] = useState<View>('today');
  const profile = useLiveQuery(() => getProfile(), []);

  // Undefined means the query has not resolved yet - not that there is no
  // profile. Rendering onboarding here would flash it on every cold start.
  if (profile === undefined) {
    return <div className="app" />;
  }

  if (!profile || profile.onboardedAt === null) {
    return (
      <div className="app">
        <Onboarding onDone={() => setView('today')} />
      </div>
    );
  }

  return (
    <>
      <div className="app">
        {view === 'today' && <SessionScreen />}
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
            onClick={() => setView(tab.id)}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import { getProfile, updateProfile } from '../db/repo';
import { programFor } from '../domain/templates';
import { adjustmentsEnabled } from '../domain/readiness';
import { DataPanel } from './DataPanel';
import type { Goal, Experience } from '../db/schema';

const GOAL_LABEL: Record<Goal, string> = {
  muscle: 'Build muscle',
  strength: 'Get stronger',
  health: 'Stay healthy',
  energy: 'Feel better day to day',
};

const EXPERIENCE_LABEL: Record<Experience, string> = {
  never: 'New to lifting',
  some: 'Some experience',
  experienced: 'Experienced',
};

export function YouScreen() {
  const profile = useLiveQuery(() => getProfile(), []);
  if (!profile) return <p className="loading-note">Loading…</p>;

  const program = programFor(profile.daysPerWeek);

  return (
    <>
      <header className="masthead">
        <p className="eyebrow">You</p>
        <h1>Your programme</h1>
        <p className="sub">{program.name}.</p>
      </header>

      <section className="card">
        <header>
          <h2>Training days a week</h2>
          <p className="hint">
            Changing this switches your programme. Your logged history stays exactly
            as it is.
          </p>
        </header>
        <div className="chips">
          {[2, 3, 4].map((days) => (
            <button
              key={days}
              type="button"
              className={`chip ${profile.daysPerWeek === days ? 'selected' : ''}`}
              aria-pressed={profile.daysPerWeek === days}
              onClick={() => void updateProfile({ daysPerWeek: days })}
            >
              {days} days
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <header>
          <h2>Daily check-in</h2>
          <p className="hint">
            When this is on, a poor night&rsquo;s sleep takes up to 10% off the bar
            and, on a bad day, one set. It is always shown before it happens, and
            you can put it back in one tap.
          </p>
        </header>
        <div className="chips">
          {(['on', 'off'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`chip ${adjustmentsEnabled(profile) === (value === 'on') ? 'selected' : ''}`}
              aria-pressed={adjustmentsEnabled(profile) === (value === 'on')}
              onClick={() => void updateProfile({ readinessAdjustments: value })}
            >
              {value === 'on' ? 'Adjust my sessions' : 'Just show me the reading'}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <header>
          <h2>Profile</h2>
        </header>
        <div>
          <div className="row">
            <div className="row-text">
              <div className="row-title">Goal</div>
            </div>
            <span className="pill">{GOAL_LABEL[profile.goal]}</span>
          </div>
          <div className="row">
            <div className="row-text">
              <div className="row-title">Experience</div>
            </div>
            <span className="pill">{EXPERIENCE_LABEL[profile.experience]}</span>
          </div>
          <div className="row">
            <div className="row-text">
              <div className="row-title">Training at</div>
            </div>
            <span className="pill">{profile.location === 'gym' ? 'A gym' : 'Home'}</span>
          </div>
          {profile.bodyWeightKg !== null && (
            <div className="row">
              <div className="row-text">
                <div className="row-title">Body weight</div>
              </div>
              <span className="pill">{profile.bodyWeightKg} kg</span>
            </div>
          )}
          {profile.limitations.length > 0 && (
            <div className="row">
              <div className="row-text">
                <div className="row-title">Working around</div>
                <div className="row-hint">These are excluded from your programme.</div>
              </div>
              <span className="pill">{profile.limitations.join(', ')}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => void updateProfile({ onboardedAt: null })}
        >
          Answer the setup questions again
        </button>
      </section>

      <DataPanel />

      <p className="footnote">
        Not medical advice. Talk to a clinician about periods that stop, pain, or
        injury.
      </p>
    </>
  );
}

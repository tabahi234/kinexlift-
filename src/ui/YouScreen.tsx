import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getProfile, updateProfile } from '../db/repo';
import { liftingDaysIn, programFor } from '../domain/templates';
import { adjustmentsEnabled } from '../domain/readiness';
import {
  cloudSyncEnabled,
  coachEnabled,
  countryOf,
  dietPatternOf,
  foodAvoidOf,
  trainingStyleOf,
} from '../domain/profile';
import { AVOIDABLE, DIET_LABEL } from '../domain/foods';
import { CUISINE_HINT, cuisineForCountry } from '../domain/cuisines';
import { CountryPicker } from './CountryPicker';
import { resetSyncCursors, syncNow, type SyncOutcome } from '../lib/sync';
import { supabaseConfigured } from '../lib/supabase';
import { DataPanel } from './DataPanel';
import { AccountCard } from './AccountCard';
import type {
  CycleTracking,
  DietPattern,
  Goal,
  Experience,
  TrainingStyle,
} from '../db/schema';

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

const STYLE_LABEL: Record<TrainingStyle, string> = {
  strength: 'Lifting only',
  hybrid: 'Hybrid',
};


const CYCLE_LABEL: Record<CycleTracking, string> = {
  track: 'Track it',
  contraception: 'On hormonal contraception',
  off: 'Not for me',
};

type Panel = 'training' | 'food' | 'account';

/**
 * A short paragraph that is there when she wants it and gone when she does not.
 *
 * Every card on this screen used to carry three lines of explanation, always
 * open. Each one was worth saying and the nine of them together were a wall
 * that people scrolled past without reading any of it - which is the worst of
 * both: the length of an explanation and the effect of none. The reasoning is
 * still here, one tap away, on the cards where a reasonable person would ask
 * why.
 */
function Why({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="why">
      <button
        type="button"
        className="link-btn"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide' : 'Why?'}
      </button>
      {open && <p className="hint">{children}</p>}
    </div>
  );
}

export function YouScreen() {
  const profile = useLiveQuery(() => getProfile(), []);
  const [syncState, setSyncState] = useState<SyncOutcome | 'running' | null>(null);
  const [panel, setPanel] = useState<Panel>('training');

  if (!profile) return <p className="loading-note">Loading…</p>;

  const style = trainingStyleOf(profile);
  const program = programFor(profile.daysPerWeek, style);
  const dayOptions = style === 'hybrid' ? [2, 3, 4, 5] : [2, 3, 4];

  const tabs: { id: Panel; label: string }[] = [
    { id: 'training', label: 'Training' },
    { id: 'food', label: 'Food & cycle' },
    { id: 'account', label: 'Account' },
  ];

  return (
    <>
      <header className="masthead">
        <p className="eyebrow">You</p>
        <h1>Settings</h1>
        <p className="sub">
          {program.name}.
          {style === 'hybrid' &&
            ` ${liftingDaysIn(program)} lifting ${liftingDaysIn(program) === 1 ? 'day' : 'days'} and ${
              program.days.length - liftingDaysIn(program)
            } conditioning in each turn.`}
        </p>
      </header>

      <div className="segmented" role="tablist" aria-label="Settings sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={panel === tab.id}
            className={`segment ${panel === tab.id ? 'selected' : ''}`}
            onClick={() => setPanel(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {panel === 'training' && (
        <>
          <section className="card">
            <header>
              <h2>What kind of training</h2>
            </header>
            <div className="chips">
              {(['strength', 'hybrid'] as TrainingStyle[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`chip ${style === value ? 'selected' : ''}`}
                  aria-pressed={style === value}
                  onClick={() => void updateProfile({ trainingStyle: value })}
                >
                  {STYLE_LABEL[value]}
                </button>
              ))}
            </div>
            <Why>
              Hybrid puts conditioning days into the same rotation as your lifting
              days, so they get programmed and progressed rather than left to
              willpower. It uses some of your week, so the lifting days go down.
            </Why>
            {style === 'hybrid' && profile.daysPerWeek <= 2 && (
              <p className="fineprint">
                At two days a week that is one lifting session per rotation, which is
                thin. Three or more suits hybrid better.
              </p>
            )}
          </section>

          <section className="card">
            <header>
              <h2>Days a week</h2>
            </header>
            <div className="chips">
              {dayOptions.map((days) => (
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
            <p className="fineprint">Your logged history stays exactly as it is.</p>
          </section>

          <section className="card">
            <header>
              <h2>Daily check-in</h2>
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
                  {value === 'on' ? 'Adjust my sessions' : 'Just show the reading'}
                </button>
              ))}
            </div>
            <Why>
              With this on, a poor night&rsquo;s sleep takes up to 10% off the bar
              and, on a bad day, one set. It is always shown before it happens, and
              you can put it back in one tap.
            </Why>
          </section>

          <section className="card">
            <header>
              <h2>About you</h2>
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
                <span className="pill">
                  {profile.location === 'gym' ? 'A gym' : 'Home'}
                </span>
              </div>
              {profile.bodyWeightKg !== null && (
                <div className="row">
                  <div className="row-text">
                    <div className="row-title">Body weight</div>
                  </div>
                  <span className="pill">{profile.bodyWeightKg} kg</span>
                </div>
              )}
              {profile.heightCm !== null && (
                <div className="row">
                  <div className="row-text">
                    <div className="row-title">Height</div>
                  </div>
                  <span className="pill">{profile.heightCm} cm</span>
                </div>
              )}
              {profile.limitations.length > 0 && (
                <div className="row">
                  <div className="row-text">
                    <div className="row-title">Working around</div>
                    <div className="row-hint">Excluded from your programme.</div>
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
        </>
      )}

      {panel === 'food' && (
        <>
          <section className="card">
            <header>
              <h2>How you eat</h2>
            </header>
            <div className="chips">
              {(['omnivore', 'halal', 'vegetarian', 'vegan'] as DietPattern[]).map(
                (value) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip ${dietPatternOf(profile) === value ? 'selected' : ''}`}
                    aria-pressed={dietPatternOf(profile) === value}
                    onClick={() => void updateProfile({ dietPattern: value })}
                  >
                    {DIET_LABEL[value]}
                  </button>
                ),
              )}
            </div>

            <p className="scale-question">Anything to leave out entirely?</p>
            <div className="chips">
              {AVOIDABLE.map((option) => {
                const selected = foodAvoidOf(profile).includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`chip small ${selected ? 'selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() =>
                      void updateProfile({
                        foodAvoid: selected
                          ? foodAvoidOf(profile).filter((item) => item !== option.id)
                          : [...foodAvoidOf(profile), option.id],
                      })
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="fineprint">
              These are the only food settings that remove things. Nothing you rule
              out here is ever suggested.
            </p>
          </section>

          <section className="card">
            <header>
              <h2>Where you cook</h2>
            </header>
            <CountryPicker
              country={countryOf(profile)}
              onPick={(code) => void updateProfile({ country: code })}
            />
            <p className="fineprint">
              {cuisineForCountry(countryOf(profile)) === null
                ? 'Nothing set, so the food table is in its own order.'
                : `${CUISINE_HINT[cuisineForCountry(countryOf(profile))!]}. Everything else is one search away.`}
            </p>
            <Why>
              This only changes the order things appear in: the search, the meal
              plans, and what the coach may offer. It never hides a food, because
              plenty of people cook outside their postcode.
            </Why>
          </section>

          <section className="card">
            <header>
              <h2>Cycle tracking</h2>
            </header>
            <div className="chips">
              {(['track', 'contraception', 'off'] as CycleTracking[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`chip ${profile.cycleTracking === value ? 'selected' : ''}`}
                  aria-pressed={profile.cycleTracking === value}
                  onClick={() => void updateProfile({ cycleTracking: value })}
                >
                  {CYCLE_LABEL[value]}
                </button>
              ))}
            </div>
            <Why>
              With this on, a Cycle tab appears under Progress. It never changes
              your weights. That is what the daily check-in is for, and fixed
              per-phase weight multipliers are not supported by the evidence.
            </Why>
          </section>
        </>
      )}

      {panel === 'account' && (
        <>
          <section className="card">
            <header>
              <h2>The coach</h2>
            </header>
            <div className="chips">
              {[true, false].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  className={`chip ${coachEnabled(profile) === value ? 'selected' : ''}`}
                  aria-pressed={coachEnabled(profile) === value}
                  onClick={() => void updateProfile({ coachOptIn: value })}
                >
                  {value ? 'On' : 'Off'}
                </button>
              ))}
            </div>
            <p className="fineprint">
              Sends a summary of your training to a language model to answer a
              question. Off by default.
            </p>
          </section>

          {supabaseConfigured() && (
            <section className="card">
              <header>
                <h2>Backup to an account</h2>
                <p className="hint">
                  Copies your log to a server so a second device can read it,
                  including anything you have recorded about your cycle.
                </p>
              </header>

              <AccountCard />

              <div className="chips">
                {[false, true].map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    className={`chip ${cloudSyncEnabled(profile) === value ? 'selected' : ''}`}
                    aria-pressed={cloudSyncEnabled(profile) === value}
                    onClick={() => {
                      // Turning backup on starts from scratch. The cursors track
                      // what has already been sent, and after a gap - or after the
                      // tables were rebuilt - trusting them would silently skip
                      // everything logged in between.
                      if (value) resetSyncCursors();
                      void updateProfile({ cloudSync: value });
                    }}
                  >
                    {value ? 'Back it up' : 'Keep it on this device'}
                  </button>
                ))}
              </div>

              {cloudSyncEnabled(profile) && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={syncState === 'running'}
                    onClick={async () => {
                      setSyncState('running');
                      setSyncState(await syncNow());
                    }}
                  >
                    {syncState === 'running' ? 'Backing up…' : 'Back up now'}
                  </button>
                  {syncState && syncState !== 'running' && (
                    /* A refusal to upload somebody else's log is not fine
                       print. It is the one message on this screen she has to
                       act on, and it names what to do. */
                    <p
                      className={
                        syncState.ok
                          ? 'fineprint'
                          : syncState.reason === 'foreign-data'
                            ? 'message warning'
                            : 'fineprint'
                      }
                    >
                      {syncState.ok
                        ? `Sent ${syncState.pushed}, received ${syncState.pulled}.`
                        : syncState.message}
                    </p>
                  )}
                </>
              )}

              <Why>
                The export file below is a complete backup and needs no account at
                all. It is the safer option if you only use one device. An account
                exists so a second device can pick up where the first left off.
              </Why>
            </section>
          )}

          <DataPanel />
        </>
      )}

      <p className="footnote">
        Not medical advice. Talk to a clinician about periods that stop, pain, or
        injury.
      </p>
    </>
  );
}

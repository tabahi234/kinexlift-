import { useEffect, useState } from 'react';
import {
  deleteSet,
  finishSession,
  logSet,
  setReadinessAdjustments,
  setReadinessOverride,
  startSession,
  swapExercise,
} from '../../db/actions';
import { isBodyweight, isTimed, type Exercise } from '../../domain/exercises';
import type { PlannedExercise, PlannedSession } from '../../domain/plan';
import type { SetLog } from '../../db/schema';
import { adjustmentsEnabled } from '../../domain/readiness';
import { useTodaysPlan } from '../useTodaysPlan';
import { CheckinForm, ReadinessBanner } from '../checkin/CheckinCard';
import { ConditioningCard } from './ConditioningCard';
import { checkinSkippedOn, skipCheckinOn } from '../../lib/storage';
import { dateKey } from '../../lib/date';
import { NextUp } from '../NextUp';
import { AskPanel } from '../coach/AskPanel';
import { useFocusEffect } from '../nav';

const KIND_LABEL: Record<string, string> = {
  calibrate: 'First time',
  increase: 'Going up',
  hold: 'Same weight',
  deload: 'Backing off',
};

function Stepper({
  label,
  value,
  step,
  min,
  onChange,
  format,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-control">
        <button
          type="button"
          className="stepper-btn"
          aria-label={`Decrease ${label}`}
          disabled={value - step < min}
          onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))}
        >
          −
        </button>
        <span className="stepper-value">{format ? format(value) : value}</span>
        <button
          type="button"
          className="stepper-btn"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(Math.round((value + step) * 100) / 100)}
        >
          +
        </button>
      </div>
    </div>
  );
}

function SetLogger({
  exercise,
  startWeight,
  startReps,
  onLog,
}: {
  exercise: Exercise;
  startWeight: number;
  startReps: number;
  onLog: (input: { weightKg: number; reps: number; rir: number | null }) => Promise<void>;
}) {
  const [weightKg, setWeight] = useState(startWeight);
  const [reps, setReps] = useState(startReps);
  const [rir, setRir] = useState<number | null>(2);
  const [busy, setBusy] = useState(false);

  // A new prescription (or a swapped exercise) should reset the inputs.
  useEffect(() => {
    setWeight(startWeight);
    setReps(startReps);
  }, [startWeight, startReps, exercise.id]);

  const bodyweight = isBodyweight(exercise);

  return (
    <div className="set-logger">
      <div className="stepper-row">
        {!bodyweight && (
          <Stepper
            label="Weight"
            value={weightKg}
            step={exercise.incrementKg}
            min={0}
            onChange={setWeight}
            format={(value) => `${value} kg`}
          />
        )}
        <Stepper
          label={isTimed(exercise) ? 'Seconds' : 'Reps'}
          value={reps}
          step={isTimed(exercise) ? 5 : 1}
          min={1}
          onChange={setReps}
        />
      </div>

      <div className="rir-row">
        <span className="stepper-label">
          {isTimed(exercise) ? 'Could you have held longer?' : 'Reps left in the tank'}
        </span>
        <div className="chips tight">
          {[0, 1, 2, 3].map((value) => (
            <button
              key={value}
              type="button"
              className={`chip small ${rir === value ? 'selected' : ''}`}
              aria-pressed={rir === value}
              onClick={() => setRir(value)}
            >
              {value === 0 ? 'None' : value === 3 ? '3+' : value}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onLog({ weightKg: bodyweight ? 0 : weightKg, reps, rir });
          setBusy(false);
        }}
      >
        Log set
      </button>
    </div>
  );
}

function ExerciseCard({
  planned,
  logged,
  sessionId,
}: {
  planned: PlannedExercise;
  logged: SetLog[];
  sessionId: string | null;
}) {
  const [showSwap, setShowSwap] = useState(false);
  const { exercise, prescription } = planned;
  const [bottom, top] = prescription.repRange;
  const done = logged.length;
  const complete = done >= prescription.sets;

  const eased = prescription.readiness;
  const easedParts: string[] = [];
  if (eased && eased.originalWeightKg !== prescription.weightKg) {
    easedParts.push(`${eased.originalWeightKg} kg`);
  }
  if (eased && eased.originalSets !== prescription.sets) {
    easedParts.push(`${eased.originalSets} sets`);
  }
  const easedFrom = easedParts.join(' and ');

  return (
    <section className={`card exercise-card ${complete ? 'complete' : ''}`}>
      <header className="exercise-head">
        <div>
          <h3>{exercise.name}</h3>
          <p className="cue">{exercise.cue}</p>
        </div>
        {/*
          A row of dots rather than a bare fraction. Mid-set, "two down, one to
          go" is a thing to see at a glance rather than read - and the number
          stays next to it, because this is still an app about numbers.
        */}
        <span className={`set-tally ${complete ? 'good' : ''}`}>
          <span className="set-dots" aria-hidden="true">
            {Array.from({ length: prescription.sets }, (_, index) => (
              <span key={index} className={`set-dot ${index < done ? 'on' : ''}`} />
            ))}
          </span>
          {done}/{prescription.sets}
        </span>
      </header>

      <div className="prescription">
        <span className="prescription-main">
          {isBodyweight(exercise) ? 'Bodyweight' : `${prescription.weightKg} kg`}
          <span className="prescription-x"> × </span>
          {bottom} to {top} {isTimed(exercise) ? 'seconds' : 'reps'}
        </span>
        <span className={`tag tag-${prescription.kind}`}>{KIND_LABEL[prescription.kind]}</span>
      </div>

      {easedFrom && (
        // Never move a number without showing what it was - and only name the
        // things that actually moved.
        <p className="eased-note">
          Eased from <span className="was">{easedFrom}</span> for today.
        </p>
      )}

      <p className="rationale">{prescription.rationale}</p>

      {done > 0 && (
        <div className="logged-sets">
          {logged.map((set, index) => (
            <button
              key={set.id}
              type="button"
              className="logged-set"
              title="Tap to remove this set"
              onClick={() => void deleteSet(set.id)}
            >
              <span className="logged-index">{index + 1}</span>
              {isTimed(exercise)
                ? `${set.reps}s`
                : isBodyweight(exercise)
                  ? `${set.reps} reps`
                  : `${set.weightKg} × ${set.reps}`}
              {set.rir !== null && <span className="logged-rir">RIR {set.rir}</span>}
            </button>
          ))}
        </div>
      )}

      {sessionId && !complete && (
        <SetLogger
          exercise={exercise}
          startWeight={prescription.weightKg}
          startReps={bottom}
          onLog={async (input) => {
            await logSet(sessionId, exercise.id, input);
          }}
        />
      )}

      {sessionId && complete && <p className="done-note">All sets logged. Nice work.</p>}

      {planned.alternatives.length > 0 && (
        <div className="swap">
          <button type="button" className="link-btn" onClick={() => setShowSwap(!showSwap)}>
            {showSwap ? 'Never mind' : 'Swap this exercise'}
          </button>
          {showSwap && (
            <div className="chips tight">
              {planned.alternatives.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="chip small"
                  onClick={async () => {
                    await swapExercise(planned.slotKey, option.id);
                    setShowSwap(false);
                  }}
                >
                  {option.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function SessionScreen() {
  const today = useTodaysPlan();
  const [editingCheckin, setEditingCheckin] = useState(false);
  const [skippedCheckin, setSkippedCheckin] = useState(() =>
    checkinSkippedOn(dateKey()),
  );
  const [dismissedOffer, setDismissedOffer] = useState(false);

  useFocusEffect((focus) => {
    if (focus === 'checkin') setEditingCheckin(true);
  });

  if (!today) return <p className="loading-note">Loading your session…</p>;
  if (!today.plan || !today.profile) return null;

  const { plan, profile, openSession, loggedSets, loggedConditioning, checkin, readiness } =
    today;
  const overridden = openSession?.readinessOverride === true;
  const adjustmentsOn = adjustmentsEnabled(profile);

  // `skippedCheckin` is what makes the skip button do anything. Without it the
  // gate below is true whenever there is no check-in, so dismissing the form
  // re-rendered the same form: a dead end on the first screen of the app, and
  // the only way past it was to answer three questions she had declined.
  if (editingCheckin || (!checkin && !openSession && !skippedCheckin)) {
    return (
      <>
        <header className="masthead">
          <p className="eyebrow">Before you start</p>
          <h1>Today</h1>
        </header>
        <CheckinForm
          profile={profile}
          existing={checkin}
          onDone={() => setEditingCheckin(false)}
        />
        {!checkin && (
          <button
            type="button"
            className="btn btn-quiet btn-block"
            onClick={() => {
              setEditingCheckin(false);
              setSkippedCheckin(true);
              skipCheckinOn(dateKey());
            }}
          >
            Skip for today
          </button>
        )}
      </>
    );
  }

  const setsFor = (exerciseId: string) =>
    loggedSets.filter((set) => set.exerciseId === exerciseId);

  const isConditioning = plan.conditioning !== null;
  const totalLogged = isConditioning ? loggedConditioning.length : loggedSets.length;
  const totalPlanned = isConditioning
    ? 1
    : plan.exercises.reduce((sum, entry) => sum + entry.prescription.sets, 0);
  const wasEased = isConditioning
    ? plan.conditioning?.readiness !== undefined
    : plan.exercises.some((entry) => entry.prescription.readiness);

  return (
    <>
      <header className="masthead">
        <p className="eyebrow">{plan.program.name}</p>
        <h1>{plan.day.name}</h1>
        <p className="sub">
          {isConditioning
            ? openSession
              ? totalLogged > 0
                ? 'Logged. Finish when you are ready.'
                : 'Log it when you are done.'
              : `About ${plan.conditioning!.minutes} minutes.`
            : openSession
              ? `${totalLogged} of ${totalPlanned} sets logged.`
              : `${plan.exercises.length} exercises. Roughly 45 minutes.`}
        </p>

        {/* Only while a session is actually running - a full-width empty bar
            on a screen she has not started yet is decoration, not feedback. */}
        {openSession && totalPlanned > 0 && (
          <div
            className="session-progress"
            role="progressbar"
            aria-valuenow={totalLogged}
            aria-valuemin={0}
            aria-valuemax={totalPlanned}
            aria-label="Sets logged this session"
          >
            <div
              className="session-progress-fill"
              style={{ width: `${Math.min(100, (totalLogged / totalPlanned) * 100)}%` }}
            />
          </div>
        )}
      </header>

      <NextUp />

      {/*
        No prompt when there is no check-in: the strip above already has it as
        the first thing on the list, with a button. Two cards asking for the
        same three taps is how a screen starts feeling like a form.
      */}
      {readiness && (
        <ReadinessBanner
          readiness={readiness}
          adjustmentsOn={adjustmentsOn}
          overridden={overridden}
          onEdit={() => setEditingCheckin(true)}
        />
      )}

      {today.offerToStopAdjusting && !dismissedOffer && (
        <div className="message">
          <p>
            You have used your full weights on most of the lighter days recently.
            Want to stop adjusting them?
          </p>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void setReadinessAdjustments('off')}
            >
              Stop adjusting
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setDismissedOffer(true)}
            >
              Keep them
            </button>
          </div>
        </div>
      )}

      {!openSession && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => void startSession(plan.day.id)}
        >
          Start this session
        </button>
      )}

      {openSession && adjustmentsOn && (wasEased || overridden) && (
        <button
          type="button"
          className="btn btn-quiet btn-block"
          onClick={() => void setReadinessOverride(openSession.id, !overridden)}
        >
          {overridden
            ? 'Use the lighter session after all'
            : isConditioning
              ? 'Do the full session today'
              : 'Use my full weights today'}
        </button>
      )}

      {plan.conditioning ? (
        <ConditioningCard
          prescription={plan.conditioning}
          profile={profile}
          sessionId={openSession?.id ?? null}
          logged={loggedConditioning}
        />
      ) : (
        plan.exercises.map((planned) => (
          <ExerciseCard
            key={planned.slotKey}
            planned={planned}
            logged={setsFor(planned.exercise.id)}
            sessionId={openSession?.id ?? null}
          />
        ))
      )}

      {openSession && (
        <button
          type="button"
          className={`btn btn-block ${totalLogged > 0 ? 'btn-primary' : 'btn-quiet'}`}
          onClick={() => void finishSession(openSession.id)}
        >
          {totalLogged > 0 ? 'Finish session' : 'Cancel session'}
        </button>
      )}

      <AskPanel
        title="Ask about today"
        hint="It knows this session, how the lifts are moving and how you said you feel. Tell it what you lifted and it writes the sets down for you; tell it what hurts and it can swap the movement."
        focus="training"
        suggestions={askSuggestions(plan, checkin !== null)}
      />
    </>
  );
}

/**
 * Openers for the ask box, taken from what today actually is.
 *
 * A generic "ask me anything" chip is the reason most in-app assistants are
 * never tapped. These name the session in front of her.
 */
function askSuggestions(plan: PlannedSession, checkedIn: boolean): string[] {
  if (plan.conditioning) {
    return [
      'Is this too much cardio this week?',
      'Can I do this outside instead?',
      `Why ${plan.conditioning.minutes} minutes?`,
    ];
  }

  const first = plan.exercises[0];
  const name = first?.exercise.name;
  return [
    // Logging by sentence is the least discoverable thing the coach does, so
    // the opener spells out the exact shape of it with today's own numbers.
    first
      ? `I did 3 sets of 10 on the ${name!.toLowerCase()} at ${first.prescription.weightKg} kg.`
      : 'Log what I just did.',
    name ? `Give me something else instead of the ${name.toLowerCase()}.` : 'Swap something in today’s session.',
    'My knee is sore today. What should I change?',
    checkedIn ? 'Why are today’s weights what they are?' : 'Should I train today at all?',
  ];
}

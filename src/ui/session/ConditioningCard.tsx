import { useEffect, useState } from 'react';
import { logConditioning } from '../../db/actions';
import {
  MODALITIES,
  modalityLabel,
  suggestedModality,
  type ConditioningPrescription,
} from '../../domain/conditioning';
import type { ConditioningLog, ConditioningModality, Profile } from '../../db/schema';

/**
 * The conditioning day.
 *
 * It looks and behaves like the exercise card next to it on purpose: a
 * prescription, a reason for it, a way to log what actually happened. Cardio
 * presented as a free-text note in a lifting app is cardio that stops
 * happening, and the whole point of the hybrid option is that the endurance
 * work is programmed rather than left to willpower.
 */

function intervalShape(prescription: ConditioningPrescription): string | null {
  if (prescription.rounds === null || prescription.workSeconds === null) return null;
  const rest = prescription.restSeconds ?? 90;
  return `${prescription.rounds} rounds: ${prescription.workSeconds}s hard, ${rest}s easy`;
}

export function ConditioningCard({
  prescription,
  profile,
  sessionId,
  logged,
}: {
  prescription: ConditioningPrescription;
  profile: Profile;
  sessionId: string | null;
  logged: ConditioningLog[];
}) {
  const lastModality = logged.at(-1)?.modality;
  const [modality, setModality] = useState<ConditioningModality>(() =>
    suggestedModality(profile.equipment, lastModality),
  );
  const [minutes, setMinutes] = useState(prescription.minutes);
  const [rpe, setRpe] = useState(prescription.targetRpe[0]);
  const [busy, setBusy] = useState(false);

  // A readiness adjustment or a new prescription should move the inputs with
  // it, or she logs against a number the screen has stopped showing.
  useEffect(() => {
    setMinutes(prescription.minutes);
    setRpe(prescription.targetRpe[0]);
  }, [prescription.minutes, prescription.targetRpe[0], prescription.kind]);

  const shape = intervalShape(prescription);
  const done = logged.length > 0;
  const eased = prescription.readiness;

  return (
    <section className={`card exercise-card ${done ? 'complete' : ''}`}>
      <header className="exercise-head">
        <div>
          <h3>{prescription.kind === 'easy' ? 'Easy conditioning' : 'Intervals'}</h3>
          <p className="cue">
            {prescription.kind === 'easy'
              ? 'Steady, conversational, and genuinely easy. This is the session that builds the engine.'
              : 'Short hard efforts with real recovery between them.'}
          </p>
        </div>
        <span className={`pill ${done ? 'good' : ''}`}>{done ? 'Done' : 'To do'}</span>
      </header>

      <div className="prescription">
        <span className="prescription-main">
          {prescription.minutes}
          <span className="prescription-x"> min </span>
          <span className="prescription-sub">
            at {prescription.targetRpe[0]} to {prescription.targetRpe[1]} out of 10
          </span>
        </span>
        <span className={`tag tag-${prescription.kind === 'easy' ? 'hold' : 'increase'}`}>
          {prescription.kind === 'easy' ? 'Easy' : 'Hard'}
        </span>
      </div>

      {shape && <p className="interval-shape">{shape}</p>}

      {eased && (
        <p className="eased-note">
          Eased from <span className="was">{eased.originalMinutes} min</span> for today.
        </p>
      )}

      <p className="rationale">{prescription.rationale}</p>

      {logged.length > 0 && (
        <div className="logged-sets">
          {logged.map((entry) => (
            <span key={entry.id} className="logged-set static">
              {modalityLabel(entry.modality)} · {entry.minutes} min
              <span className="logged-rir">RPE {entry.rpe}</span>
            </span>
          ))}
        </div>
      )}

      {sessionId && !done && (
        <div className="set-logger">
          <div className="rir-row">
            <span className="stepper-label">What did you do?</span>
            <div className="chips tight">
              {MODALITIES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`chip small ${modality === option.id ? 'selected' : ''}`}
                  aria-pressed={modality === option.id}
                  onClick={() => setModality(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="fineprint">
              {MODALITIES.find((option) => option.id === modality)?.note}
            </p>
          </div>

          <div className="stepper-row">
            <div className="stepper">
              <span className="stepper-label">Minutes</span>
              <div className="stepper-control">
                <button
                  type="button"
                  className="stepper-btn"
                  aria-label="Decrease minutes"
                  disabled={minutes <= 5}
                  onClick={() => setMinutes(Math.max(5, minutes - 5))}
                >
                  −
                </button>
                <span className="stepper-value">{minutes}</span>
                <button
                  type="button"
                  className="stepper-btn"
                  aria-label="Increase minutes"
                  onClick={() => setMinutes(minutes + 5)}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="rir-row">
            <span className="stepper-label">How hard was it, out of 10?</span>
            <div className="chips tight">
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`chip small ${rpe === value ? 'selected' : ''}`}
                  aria-pressed={rpe === value}
                  onClick={() => setRpe(value)}
                >
                  {value}
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
              await logConditioning(
                {
                  modality,
                  kind: prescription.kind,
                  minutes,
                  rpe,
                  distanceKm: null,
                  rounds: prescription.rounds,
                  workSeconds: prescription.workSeconds,
                  restSeconds: prescription.restSeconds,
                },
                sessionId,
              );
              setBusy(false);
            }}
          >
            Log this session
          </button>
        </div>
      )}

      {done && <p className="done-note">Logged. Next one builds on this.</p>}
    </section>
  );
}

import { useState } from 'react';
import { clearTodaysCheckin, saveCheckin } from '../../db/actions';
import { symptomsFor, SCALE_MAX, SCALE_MIN, type Readiness } from '../../domain/readiness';
import type { Checkin, Profile, SymptomTag } from '../../db/schema';

/**
 * Three taps in the morning. This is the input that replaces guessing her
 * capacity from a calendar - and, over months, the raw material for spotting
 * patterns that are actually hers.
 */

interface ScaleProps {
  question: string;
  low: string;
  high: string;
  value: number;
  onChange: (value: number) => void;
}

function Scale({ question, low, high, value, onChange }: ScaleProps) {
  const steps = Array.from(
    { length: SCALE_MAX - SCALE_MIN + 1 },
    (_, index) => SCALE_MIN + index,
  );

  return (
    <fieldset className="scale">
      <legend className="scale-question">{question}</legend>
      <div className="scale-buttons" role="radiogroup" aria-label={question}>
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            role="radio"
            aria-checked={value === step}
            aria-label={`${step} out of ${SCALE_MAX}`}
            className={`scale-step ${value === step ? 'selected' : ''}`}
            onClick={() => onChange(step)}
          >
            {step}
          </button>
        ))}
      </div>
      <div className="scale-ends">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  );
}

export function CheckinForm({
  profile,
  existing,
  onDone,
}: {
  profile: Profile;
  existing: Checkin | null;
  onDone: () => void;
}) {
  const [sleep, setSleep] = useState(existing?.sleep ?? 3);
  const [energy, setEnergy] = useState(existing?.energy ?? 3);
  const [soreness, setSoreness] = useState(existing?.soreness ?? 2);
  const [symptoms, setSymptoms] = useState<SymptomTag[]>(existing?.symptoms ?? []);
  const [busy, setBusy] = useState(false);

  const options = symptomsFor(profile.cycleTracking === 'track');

  return (
    <section className="card">
      <header>
        <h2>How are you today?</h2>
        <p className="hint">
          Three quick answers. They tune today&rsquo;s session, and nothing else
          changes without showing you first.
        </p>
      </header>

      <Scale
        question="How did you sleep?"
        low="Badly"
        high="Great"
        value={sleep}
        onChange={setSleep}
      />
      <Scale
        question="Energy right now?"
        low="Empty"
        high="Full"
        value={energy}
        onChange={setEnergy}
      />
      <Scale
        question="How sore are you?"
        low="Not at all"
        high="Very"
        value={soreness}
        onChange={setSoreness}
      />

      <div>
        <p className="scale-question">Anything else going on?</p>
        <div className="chips">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`chip small ${symptoms.includes(option.id) ? 'selected' : ''}`}
              aria-pressed={symptoms.includes(option.id)}
              onClick={() =>
                setSymptoms((current) =>
                  current.includes(option.id)
                    ? current.filter((tag) => tag !== option.id)
                    : [...current, option.id],
                )
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="fineprint">
          These are recorded, not scored. Your energy answer already covers how
          you feel; over a few months the app can show whether they line up with
          anything for you.
        </p>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await saveCheckin({ sleep, energy, soreness, symptoms });
          setBusy(false);
          onDone();
        }}
      >
        {existing ? 'Update' : 'Save and see today'}
      </button>
    </section>
  );
}

export function ReadinessBanner({
  readiness,
  adjustmentsOn,
  overridden,
  onEdit,
}: {
  readiness: Readiness;
  adjustmentsOn: boolean;
  overridden: boolean;
  onEdit: () => void;
}) {
  // Adjustments being off outranks everything: with nothing being changed,
  // there is no override to report either.
  const detail = !adjustmentsOn
    ? 'Adjustments are off, so your session is unchanged.'
    : overridden
      ? 'Using your full weights today.'
      : readiness.detail;

  return (
    <div className={`readiness readiness-${readiness.band}`}>
      <span className="readiness-dot" aria-hidden="true" />
      <div className="readiness-text">
        <strong>{readiness.headline}</strong>
        <span>{detail}</span>
      </div>
      <button type="button" className="link-btn" onClick={onEdit}>
        Change
      </button>
    </div>
  );
}

export function CheckinPrompt({ onStart }: { onStart: () => void }) {
  return (
    <button type="button" className="card checkin-prompt" onClick={onStart}>
      <div>
        <strong>How are you today?</strong>
        <span className="hint">
          Three taps. Today&rsquo;s session adjusts to your answer.
        </span>
      </div>
      <span className="checkin-prompt-go" aria-hidden="true">
        →
      </span>
    </button>
  );
}

export { clearTodaysCheckin };

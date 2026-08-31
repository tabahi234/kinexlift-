import { useState } from 'react';
import { updateProfile } from '../../db/repo';
import { HOME_EQUIPMENT_CHOICES, GYM_EQUIPMENT, type Equipment } from '../../domain/exercises';
import type {
  CycleTracking,
  Experience,
  Goal,
  TrainingLocation,
} from '../../db/schema';

/**
 * One question per screen, everything skippable except body weight and
 * experience, and nothing asked that the app does not visibly use. Each
 * screen says what the answer is *for*, so none of it feels like a form.
 */

interface Answers {
  goal: Goal;
  experience: Experience;
  location: TrainingLocation;
  equipment: Equipment[];
  daysPerWeek: number;
  age: number | null;
  bodyWeightKg: number | null;
  cycleTracking: CycleTracking;
  limitations: string[];
}

const INITIAL: Answers = {
  goal: 'muscle',
  experience: 'never',
  location: 'gym',
  equipment: GYM_EQUIPMENT,
  daysPerWeek: 3,
  age: null,
  bodyWeightKg: null,
  cycleTracking: 'off',
  limitations: [],
};

type StepId =
  | 'privacy'
  | 'goal'
  | 'experience'
  | 'location'
  | 'equipment'
  | 'days'
  | 'about'
  | 'cycle'
  | 'limitations';

function stepsFor(answers: Answers): StepId[] {
  const steps: StepId[] = ['privacy', 'goal', 'experience', 'location'];
  if (answers.location === 'home') steps.push('equipment');
  steps.push('days', 'about', 'cycle', 'limitations');
  return steps;
}

interface ChoiceProps<T> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint?: string }[];
}

function Choices<T extends string | number>({ value, onChange, options }: ChoiceProps<T>) {
  return (
    <div className="choices">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={`choice ${option.value === value ? 'selected' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <span className="choice-label">{option.label}</span>
          {option.hint && <span className="choice-hint">{option.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  label,
  suffix,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number | null;
  min: number;
  max: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="number-field">
      <span className="number-label">{label}</span>
      <span className="number-input">
        <input
          type="number"
          inputMode="numeric"
          value={value ?? ''}
          min={min}
          max={max}
          placeholder="—"
          onChange={(event) => {
            const next = event.target.value === '' ? null : Number(event.target.value);
            onChange(next === null || Number.isNaN(next) ? null : next);
          }}
        />
        <span className="number-suffix">{suffix}</span>
      </span>
    </label>
  );
}

const LIMITATION_CHOICES = [
  { id: 'knees', label: 'Knees' },
  { id: 'back', label: 'Lower back' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'wrists', label: 'Wrists' },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [answers, setAnswers] = useState<Answers>(INITIAL);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const steps = stepsFor(answers);
  const step = steps[Math.min(index, steps.length - 1)]!;
  const isLast = index === steps.length - 1;

  const update = <K extends keyof Answers>(key: K, value: Answers[K]) =>
    setAnswers((current) => ({ ...current, [key]: value }));

  const toggle = (key: 'equipment' | 'limitations', value: string) =>
    setAnswers((current) => {
      const list = current[key] as string[];
      const next = list.includes(value)
        ? list.filter((item) => item !== value)
        : [...list, value];
      return { ...current, [key]: next };
    });

  async function finish() {
    setSaving(true);
    const thisYear = new Date().getFullYear();
    await updateProfile({
      goal: answers.goal,
      experience: answers.experience,
      location: answers.location,
      equipment: answers.location === 'gym' ? GYM_EQUIPMENT : answers.equipment,
      daysPerWeek: answers.daysPerWeek,
      birthYear: answers.age === null ? null : thisYear - answers.age,
      bodyWeightKg: answers.bodyWeightKg,
      cycleTracking: answers.cycleTracking,
      limitations: answers.limitations,
      onboardedAt: Date.now(),
    });
    onDone();
  }

  const canContinue = step !== 'about' || answers.bodyWeightKg !== null;

  return (
    <div className="onboarding">
      <div className="progress-track" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={steps.length}>
        <div className="progress-fill" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
      </div>

      <div className="onboarding-body">
        {step === 'privacy' && (
          <>
            <h1>Before anything else</h1>
            <p className="lede">
              Everything you log stays in this browser, on this device. There is no
              account, nothing is uploaded, and no one else can see it — not even us.
            </p>
            <p className="lede">
              You can export all of it to a file at any time, and delete it in two taps.
            </p>
            <p className="fineprint">
              One catch worth knowing: if you clear your browser data, it goes too. The
              app will remind you to keep a backup.
            </p>
          </>
        )}

        {step === 'goal' && (
          <>
            <h1>What are you here for?</h1>
            <p className="lede">This sets how heavy you lift and for how many reps.</p>
            <Choices
              value={answers.goal}
              onChange={(value) => update('goal', value)}
              options={[
                { value: 'muscle', label: 'Build muscle', hint: 'Moderate weight, 8–12 reps' },
                { value: 'strength', label: 'Get stronger', hint: 'Heavier, 4–6 reps' },
                { value: 'health', label: 'Stay healthy', hint: 'Bone and muscle for the long run' },
                { value: 'energy', label: 'Feel better day to day', hint: 'Lighter, higher reps' },
              ]}
            />
          </>
        )}

        {step === 'experience' && (
          <>
            <h1>Have you lifted weights before?</h1>
            <p className="lede">
              This decides your starting weights and which lifts you get straight away.
            </p>
            <Choices
              value={answers.experience}
              onChange={(value) => update('experience', value)}
              options={[
                { value: 'never', label: 'Never', hint: 'We start light and build from there' },
                { value: 'some', label: 'A bit', hint: 'On and off, or a while ago' },
                { value: 'experienced', label: 'Years', hint: 'Comfortable under a barbell' },
              ]}
            />
          </>
        )}

        {step === 'location' && (
          <>
            <h1>Where will you train?</h1>
            <p className="lede">Every exercise you get will be one you can actually do.</p>
            <Choices
              value={answers.location}
              onChange={(value) =>
                setAnswers((current) => ({
                  ...current,
                  location: value,
                  // The gym default is "everything". Carrying that into the home
                  // screen would pre-tick kit she does not own and make her
                  // untick it, so each option starts from its own baseline.
                  equipment: value === 'gym' ? GYM_EQUIPMENT : [],
                }))
              }
              options={[
                { value: 'gym', label: 'At a gym', hint: 'Full equipment' },
                { value: 'home', label: 'At home', hint: 'We will ask what you have' },
              ]}
            />
          </>
        )}

        {step === 'equipment' && (
          <>
            <h1>What do you have at home?</h1>
            <p className="lede">
              Pick anything you own. With nothing selected you will get bodyweight
              training, which is a real place to start.
            </p>
            <div className="chips">
              {HOME_EQUIPMENT_CHOICES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`chip ${answers.equipment.includes(option.id) ? 'selected' : ''}`}
                  aria-pressed={answers.equipment.includes(option.id)}
                  onClick={() => toggle('equipment', option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'days' && (
          <>
            <h1>How many days a week?</h1>
            <p className="lede">Be honest rather than optimistic. You can change it later.</p>
            <Choices
              value={answers.daysPerWeek}
              onChange={(value) => update('daysPerWeek', value)}
              options={[
                { value: 2, label: 'Two days', hint: 'Two full-body sessions' },
                { value: 3, label: 'Three days', hint: 'Three full-body sessions' },
                { value: 4, label: 'Four days', hint: 'Upper and lower split' },
              ]}
            />
          </>
        )}

        {step === 'about' && (
          <>
            <h1>Two numbers</h1>
            <p className="lede">
              Body weight sets sensible starting loads. Age is optional and only used
              for nutrition targets later.
            </p>
            <NumberField
              label="Body weight"
              suffix="kg"
              value={answers.bodyWeightKg}
              min={30}
              max={250}
              onChange={(value) => update('bodyWeightKg', value)}
            />
            <NumberField
              label="Age"
              suffix="years"
              value={answers.age}
              min={14}
              max={99}
              onChange={(value) => update('age', value)}
            />
          </>
        )}

        {step === 'cycle' && (
          <>
            <h1>Do you want to track your cycle?</h1>
            <p className="lede">
              If you do, the app looks for patterns in <em>your</em> logs over a few
              months. It will never quietly change your weights for you.
            </p>
            <Choices
              value={answers.cycleTracking}
              onChange={(value) => update('cycleTracking', value)}
              options={[
                { value: 'track', label: 'Yes, track it', hint: 'Log periods and symptoms' },
                {
                  value: 'contraception',
                  label: 'I am on hormonal contraception',
                  hint: 'Cycle features stay off',
                },
                { value: 'off', label: 'No thanks', hint: 'Never asked again' },
              ]}
            />
          </>
        )}

        {step === 'limitations' && (
          <>
            <h1>Anything to work around?</h1>
            <p className="lede">
              Anything you pick is avoided in your programme. Leave it empty if nothing
              bothers you.
            </p>
            <div className="chips">
              {LIMITATION_CHOICES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`chip ${answers.limitations.includes(option.id) ? 'selected' : ''}`}
                  aria-pressed={answers.limitations.includes(option.id)}
                  onClick={() => toggle('limitations', option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="fineprint">
              This is not medical advice. See a clinician about pain, injury, or periods
              that stop.
            </p>
          </>
        )}
      </div>

      <div className="onboarding-actions">
        {index > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => setIndex(index - 1)}>
            Back
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canContinue || saving}
          onClick={() => (isLast ? void finish() : setIndex(index + 1))}
        >
          {isLast ? 'Build my programme' : 'Continue'}
        </button>
      </div>

      {step === 'about' && !canContinue && (
        <p className="fineprint">Body weight is the one thing the app really needs.</p>
      )}
    </div>
  );
}

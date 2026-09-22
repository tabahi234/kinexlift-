import { useState } from 'react';
import { updateProfile } from '../../db/repo';
import { logWeight } from '../../db/actions';
import { HOME_EQUIPMENT_CHOICES, GYM_EQUIPMENT, type Equipment } from '../../domain/exercises';
import { APP_NAME } from '../../config';
import { IconBowl, IconDumbbell, IconPulse, Logo } from '../icons';
import { CountryPicker } from '../CountryPicker';
import { CUISINE_LABEL, cuisineForCountry } from '../../domain/cuisines';
import { AVOIDABLE, DIET_HINT, DIET_LABEL } from '../../domain/foods';
import { guessCountry } from '../../lib/locale';
import { DEFAULT_DAYS } from '../../domain/schedule';
import { programFor } from '../../domain/templates';
import { DayPicker } from '../DayPicker';
import type {
  CycleTracking,
  DietPattern,
  Experience,
  Goal,
  TrainingLocation,
  TrainingStyle,
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
  trainingStyle: TrainingStyle;
  daysPerWeek: number;
  /** Weekdays, 0 = Sunday. `daysPerWeek` is kept equal to its length. */
  trainingDays: number[];
  age: number | null;
  bodyWeightKg: number | null;
  heightCm: number | null;
  cycleTracking: CycleTracking;
  limitations: string[];
  /** ISO country code. Decides which food she is shown first, nothing else. */
  country: string | null;
  dietPattern: DietPattern;
  foodAvoid: string[];
}

const INITIAL: Answers = {
  goal: 'muscle',
  experience: 'never',
  location: 'gym',
  equipment: GYM_EQUIPMENT,
  trainingStyle: 'strength',
  daysPerWeek: 3,
  trainingDays: DEFAULT_DAYS[3]!,
  age: null,
  bodyWeightKg: null,
  heightCm: null,
  cycleTracking: 'off',
  limitations: [],
  // Guessed from the browser's own locale, offline. She is looking
  // straight at it and can change it in one tap, so a wrong guess costs a
  // tap and a right one saves the whole question.
  country: guessCountry(),
  dietPattern: 'omnivore',
  foodAvoid: [],
};

type StepId =
  | 'welcome'
  | 'privacy'
  | 'goal'
  | 'experience'
  | 'location'
  | 'equipment'
  | 'style'
  | 'days'
  | 'about'
  | 'kitchen'
  | 'cycle'
  | 'limitations';

function stepsFor(answers: Answers): StepId[] {
  const steps: StepId[] = ['welcome', 'privacy', 'goal', 'experience', 'location'];
  if (answers.location === 'home') steps.push('equipment');
  steps.push('style', 'days', 'about', 'kitchen', 'cycle', 'limitations');
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
          placeholder=""
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

function HeightField({
  valueCm,
  onChange,
}: {
  valueCm: number | null;
  onChange: (value: number | null) => void;
}) {
  const [unit, setUnit] = useState<'cm' | 'ft'>('cm');

  const totalInches = valueCm ? Math.round(valueCm / 2.54) : null;
  const ft = totalInches !== null ? Math.floor(totalInches / 12) : null;
  const inches = totalInches !== null ? totalInches % 12 : null;

  return (
    <div className="number-field">
      <span className="number-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>Height</span>
        <button
          type="button"
          style={{ 
            fontSize: '0.75rem', 
            padding: '2px 8px', 
            borderRadius: '999px', 
            background: 'var(--rule)', 
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer'
          }}
          onClick={() => setUnit(u => u === 'cm' ? 'ft' : 'cm')}
        >
          Use {unit === 'cm' ? 'ft' : 'cm'}
        </button>
      </span>
      
      {unit === 'cm' ? (
        <label className="number-input">
          <input
            type="number"
            inputMode="numeric"
            value={valueCm ?? ''}
            min={120}
            max={220}
            placeholder=""
            onChange={(event) => {
              const next = event.target.value === '' ? null : Number(event.target.value);
              onChange(next === null || Number.isNaN(next) ? null : next);
            }}
          />
          <span className="number-suffix">cm</span>
        </label>
      ) : (
        <span className="number-input">
          <label className="number-input" style={{ gap: '2px' }}>
            <input
              type="number"
              inputMode="numeric"
              value={ft ?? ''}
              min={4}
              max={7}
              placeholder="-"
              style={{ width: '2.5ch' }}
              onChange={(event) => {
                const newFt = event.target.value === '' ? null : Number(event.target.value);
                if (newFt === null && inches === null) {
                  onChange(null);
                } else {
                  const currentInches = inches ?? 0;
                  const safeFt = newFt ?? 0;
                  onChange(Math.round((safeFt * 12 + currentInches) * 2.54));
                }
              }}
            />
            <span className="number-suffix">ft</span>
          </label>
          <label className="number-input" style={{ gap: '2px' }}>
            <input
              type="number"
              inputMode="numeric"
              value={inches ?? ''}
              min={0}
              max={11}
              placeholder="-"
              style={{ width: '3ch' }}
              onChange={(event) => {
                const newInches = event.target.value === '' ? null : Number(event.target.value);
                if (ft === null && newInches === null) {
                  onChange(null);
                } else {
                  const safeFt = ft ?? 5;
                  const safeIn = newInches ?? 0;
                  onChange(Math.round((safeFt * 12 + safeIn) * 2.54));
                }
              }}
            />
            <span className="number-suffix">in</span>
          </label>
        </span>
      )}
    </div>
  );
}


const LIMITATION_CHOICES = [
  { id: 'knees', label: 'Knees' },
  { id: 'back', label: 'Lower back' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'wrists', label: 'Wrists' },
];

const ALL_STEPS: StepId[] = [
  'welcome',
  'privacy',
  'goal',
  'experience',
  'location',
  'equipment',
  'style',
  'days',
  'about',
  'kitchen',
  'cycle',
  'limitations',
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

  const toggle = (key: 'equipment' | 'limitations' | 'foodAvoid', value: string) =>
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
      trainingStyle: answers.trainingStyle,
      daysPerWeek: answers.trainingDays.length,
      trainingDays: answers.trainingDays,
      birthYear: answers.age === null ? null : thisYear - answers.age,
      bodyWeightKg: answers.bodyWeightKg,
      heightCm: answers.heightCm,
      cycleTracking: answers.cycleTracking,
      limitations: answers.limitations,
      country: answers.country ?? undefined,
      dietPattern: answers.dietPattern,
      foodAvoid: answers.foodAvoid,
      onboardedAt: Date.now(),
    });

    // Her starting weight goes into the body-metric log as well, so the trend
    // line on the Progress screen has a first point rather than beginning at
    // whatever she happens to weigh the day she first thinks to record it.
    if (answers.bodyWeightKg !== null) await logWeight(answers.bodyWeightKg);

    onDone();
  }

  const validAge = answers.age !== null && answers.age >= 16 && answers.age <= 87;
  const validWeight = answers.bodyWeightKg !== null && answers.bodyWeightKg >= 30 && answers.bodyWeightKg <= 250;
  const validHeight = answers.heightCm === null || (answers.heightCm >= 120 && answers.heightCm <= 220);
  const canContinue = step !== 'about' || (validWeight && validAge && validHeight);

  return (
    <div className="onboarding">
      {/*
        No progress bar on the welcome screen. "One of eleven" is the first
        thing she would read, and it turns an introduction into a queue.
      */}
      {step !== 'welcome' && (() => {
        const currentAbsoluteIndex = ALL_STEPS.indexOf(step);
        return (
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={currentAbsoluteIndex}
            aria-valuemin={1}
            aria-valuemax={ALL_STEPS.length - 1}
          >
            <div
              className="progress-fill"
              style={{ width: `${(currentAbsoluteIndex / (ALL_STEPS.length - 1)) * 100}%` }}
            />
          </div>
        );
      })()}

      <div className="onboarding-body">
        {step === 'welcome' && (
          <div className="welcome-screen">
            <Logo size={72} />
            <h1 className="welcome-name">{APP_NAME}</h1>
            <p className="welcome-tagline">Your personal trainer, built for women.</p>

            {/*
              Three lines, and every one of them is something the app actually
              does differently from the app she deleted last year. A splash
              screen that only says its own name is a loading spinner with
              ambition.
            */}
            <ul className="welcome-points">
              <li>
                <span className="welcome-point-icon">
                  <IconDumbbell size={20} />
                </span>
                <span>
                  <strong>A programme that moves with you.</strong> Weights come from
                  what you actually lifted last time, not from a PDF.
                </span>
              </li>
              <li>
                <span className="welcome-point-icon">
                  <IconBowl size={20} />
                </span>
                <span>
                  <strong>Food worked out from your own numbers.</strong> Roti, jollof,
                  adobo and tortillas are in the table, not missing from it.
                </span>
              </li>
              <li>
                <span className="welcome-point-icon">
                  <IconPulse size={20} />
                </span>
                <span>
                  <strong>Your cycle as context, never as a rule.</strong> The app
                  reads how you feel today; it never quietly lowers a weight because
                  of the date.
                </span>
              </li>
            </ul>
          </div>
        )}

        {step === 'privacy' && (
          <>
            <h1>Before anything else</h1>
            <p className="lede">
              Everything you log stays in this browser, on this device. There is no
              account, and no one else can see it, not even us.
            </p>
            <p className="lede">
              Two things can send data out, and both are off until you switch them on
              yourself: the AI coach, which sends a summary of your training to
              answer a question, and backup to an account. The training app itself
              works completely offline.
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
                { value: 'muscle', label: 'Build muscle', hint: 'Moderate weight, 8 to 12 reps' },
                { value: 'strength', label: 'Get stronger', hint: 'Heavier, 4 to 6 reps' },
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

        {step === 'style' && (
          <>
            <h1>Lifting only, or lifting and conditioning?</h1>
            <p className="lede">
              Hybrid puts cardio days into the same rotation as your lifting days, so
              they are prescribed and progressed like everything else.
            </p>
            <Choices
              value={answers.trainingStyle}
              onChange={(value) => update('trainingStyle', value)}
              options={[
                {
                  value: 'strength',
                  label: 'Lifting only',
                  hint: 'Every session in your week is strength work',
                },
                {
                  value: 'hybrid',
                  label: 'Hybrid',
                  hint: 'Easy aerobic work and intervals alongside the lifting',
                },
              ]}
            />
            <p className="fineprint">
              Hybrid spends some of your week on conditioning, so there are fewer
              lifting days in each turn of the rotation. You can switch either way
              later without losing anything.
            </p>
          </>
        )}

        {step === 'days' && (
          <>
            <h1>Which days will you train?</h1>
            <p className="lede">
              Tap the days that fit your week. Be honest rather than optimistic;
              you can change them later, and a missed day never skips a session.
            </p>
            <DayPicker
              value={answers.trainingDays}
              onChange={(days) => update('trainingDays', days)}
              min={2}
              max={answers.trainingStyle === 'hybrid' ? 5 : 6}
            />
            <p className="fineprint">
              {answers.trainingDays.length} days a week:{' '}
              {programFor(answers.trainingDays.length, answers.trainingStyle).name.toLowerCase()}.
              {answers.trainingStyle === 'strength' && answers.trainingDays.length > 4
                ? ' More than four days runs the upper/lower split faster, not a bigger programme.'
                : ''}
            </p>
          </>
        )}

        {step === 'about' && (
          <>
            <h1>A few numbers</h1>
            <p className="lede">
              Body weight sets sensible starting loads, and age helps work out your food targets.
              Skip height and the Fuel screen will ask when you get there.
            </p>
            <NumberField
              label="Body weight"
              suffix="kg"
              value={answers.bodyWeightKg}
              min={30}
              max={250}
              onChange={(value) => update('bodyWeightKg', value)}
            />
            {answers.bodyWeightKg === null ? (
               <p className="fineprint" style={{ marginTop: '-8px', marginBottom: '16px', color: 'var(--text)' }}>
                 Body weight is the one thing the app really needs.
               </p>
            ) : (answers.bodyWeightKg < 30 || answers.bodyWeightKg > 250) && (
               <p className="fineprint" style={{ marginTop: '-8px', marginBottom: '16px', color: 'var(--danger, red)' }}>
                 Body weight must be between 30 and 250 kg.
               </p>
            )}
            <HeightField
              valueCm={answers.heightCm}
              onChange={(value) => update('heightCm', value)}
            />
            {answers.heightCm !== null && (answers.heightCm < 120 || answers.heightCm > 220) && (
               <p className="fineprint" style={{ marginTop: '-8px', marginBottom: '16px', color: 'var(--danger, red)' }}>
                 Height must be between 120 and 220 cm (approx 4ft - 7ft 2in).
               </p>
            )}
            <NumberField
              label="Age"
              suffix="years"
              value={answers.age}
              min={16}
              max={87}
              onChange={(value) => update('age', value)}
            />
            {answers.age === null ? (
               <p className="fineprint" style={{ marginTop: '-8px', marginBottom: '16px', color: 'var(--text)' }}>
                 Age is required.
               </p>
            ) : (answers.age < 16 || answers.age > 87) && (
               <p className="fineprint" style={{ marginTop: '-8px', marginBottom: '16px', color: 'var(--danger, red)' }}>
                 Age must be between 16 and 87.
               </p>
            )}
          </>
        )}

        {step === 'kitchen' && (
          <>
            <h1>Where do you cook?</h1>
            <p className="lede">
              This decides which food the app puts in front of you first: the
              search, the meal plans, and what the coach is allowed to offer. It
              never hides anything: a protein target you cannot hit with what is
              actually in your kitchen is a target you give up on in a fortnight.
            </p>

            <CountryPicker
              country={answers.country}
              onPick={(code) => update('country', code)}
            />

            {answers.country && cuisineForCountry(answers.country) && (
              <p className="fineprint">
                You will see {CUISINE_LABEL[cuisineForCountry(answers.country)!]} food
                first. Change it any time on You.
              </p>
            )}

            <p className="scale-question">And is there anything you do not eat?</p>
            <Choices
              value={answers.dietPattern}
              onChange={(value) => update('dietPattern', value)}
              options={(['omnivore', 'halal', 'vegetarian', 'vegan'] as DietPattern[]).map(
                (value) => ({
                  value,
                  label: DIET_LABEL[value],
                  hint: DIET_HINT[value],
                }),
              )}
            />

            <p className="scale-question">Anything to leave out entirely?</p>
            <div className="chips">
              {AVOIDABLE.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`chip small ${answers.foodAvoid.includes(option.id) ? 'selected' : ''}`}
                  aria-pressed={answers.foodAvoid.includes(option.id)}
                  onClick={() => toggle('foodAvoid', option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="fineprint">
              An allergy and a diet are kept separate, because &ldquo;I do not eat
              meat&rdquo; and &ldquo;dairy makes me ill&rdquo; fail differently and a
              meal plan has to respect both.
            </p>
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
          {isLast ? 'Build my programme' : step === 'welcome' ? 'Get started' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

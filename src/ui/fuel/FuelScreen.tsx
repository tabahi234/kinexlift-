import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getNutritionContext, type UsualFood } from '../../db/derived';
import { getMealsFor, totalsForMeals } from '../../db/queries';
import {
  clearMealsFor,
  deleteMeal,
  deleteMeals,
  logCustomMeal,
  logDayPlan,
  logMeal,
  logWeight,
  replaceDayPlan,
  setMealServings,
} from '../../db/actions';
import { updateProfile } from '../../db/repo';
import {
  allowedFoods,
  IRON_NOTE,
  IRON_TARGET_MG,
  foodFor,
  NO_NUTRIENTS,
  roundNutrients,
} from '../../domain/foods';
import { CUISINE_LABEL } from '../../domain/cuisines';
import { ESTIMATE_CAVEAT } from '../../domain/estimate';
import {
  closeProteinGap,
  SLOT_LABEL,
  SLOT_ORDER,
  type DayPlan,
} from '../../domain/meals';
import { slotForHour } from '../../domain/proposals';
import {
  ACTIVITY_HINT,
  ACTIVITY_LABEL,
  BMI_CAVEAT,
  NUTRITION_DISCLAIMER,
  readBmi,
} from '../../domain/nutrition';
import {
  activityLevelOf,
  coachEnabled,
  dietPatternOf,
  foodAvoidOf,
  weightGoalOf,
} from '../../domain/profile';
import { dateKey } from '../../lib/date';
import { FoodPicker } from './FoodPicker';
import { AskPanel } from '../coach/AskPanel';
import { useFocusEffect } from '../nav';
import { useToast } from '../ToastProvider';
import { Dial, IconBolt, IconCheck, IconPlus } from '../icons';
import type { ActivityLevel, WeightGoal } from '../../db/schema';

/**
 * Fuel.
 *
 * Every number on this screen is computed by domain/nutrition.ts from her own
 * height, weight, age and logged training - the same function the coach reads,
 * so the two can never disagree. Nothing here is a lookup table of "1,200
 * calories for weight loss".
 */

const GOAL_LABEL: Record<WeightGoal, string> = {
  lose: 'Lose fat slowly',
  maintain: 'Stay where I am',
  gain: 'Build up',
};

const GOAL_HINT: Record<WeightGoal, string> = {
  lose: 'A small deficit, floored so it never costs you muscle or your cycle',
  maintain: 'Eat at maintenance and let training do the work',
  gain: 'A lean surplus, about 250 kcal',
};

/**
 * One macro, in a quarter of the height a bar took.
 *
 * Four full-width bars, each with its own heading row and its own track,
 * was most of a screen spent on the three numbers she steers by least -
 * calories and protein are the rings above, and saying them again in bars
 * made fibre look equally important. These are tiles in a two-by-two grid:
 * the same figures, read at a glance, with the fill still there because
 * "17 / 24" is a fact and a part-filled bar is an answer.
 */
function MacroTile({
  label,
  value,
  target,
  unit,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
}) {
  const percent = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="macro-tile">
      <span className="macro-label">{label}</span>
      <span className="macro-value">
        {Math.round(value)}
        <span className="macro-target">
          {' '}
          / {Math.round(target)} {unit}
        </span>
      </span>
      <span className="macro-track">
        <span
          className={`macro-fill ${percent >= 95 ? 'full' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </span>
    </div>
  );
}

/**
 * The day at a glance.
 *
 * Two rings rather than two more numbers: calories on the outside, protein on
 * the inside, because those are the two she is actually steering by and a
 * column of digits makes them look equally important as fibre.
 */
function DayDial({
  eaten,
  targetKcal,
  targetProteinG,
}: {
  eaten: { kcal: number; proteinG: number };
  targetKcal: number;
  targetProteinG: number;
}) {
  const remaining = targetKcal - eaten.kcal;

  return (
    <div className="fuel-dial">
      <Dial
        size={150}
        rings={[
          { value: eaten.kcal, max: targetKcal, color: 'var(--accent)' },
          {
            value: eaten.proteinG,
            max: targetProteinG,
            color: 'var(--macro-protein)',
          },
        ]}
      >
        <span className="dial-big">{Math.abs(Math.round(remaining))}</span>
        <span className="dial-small">{remaining >= 0 ? 'kcal left' : 'kcal over'}</span>
      </Dial>

      <ul className="dial-legend">
        <li>
          <span className="swatch energy" />
          <span className="swatch-text">
            Calories
            <strong>
              {Math.round(eaten.kcal)} / {targetKcal}
            </strong>
          </span>
        </li>
        <li>
          <span className="swatch protein" />
          <span className="swatch-text">
            Protein
            <strong>
              {Math.round(eaten.proteinG)} / {Math.round(targetProteinG)} g
            </strong>
          </span>
        </li>
      </ul>
    </div>
  );
}

/** Asks for whatever is missing, one field at a time, and says what it is for. */
function SetupCard({
  missing,
  heightCm,
  bodyWeightKg,
  birthYear,
}: {
  missing: ('weight' | 'height' | 'age')[];
  heightCm: number | null;
  bodyWeightKg: number | null;
  birthYear: number | null;
}) {
  const thisYear = new Date().getFullYear();
  const { showToast } = useToast();
  const [height, setHeight] = useState(heightCm ?? 165);
  const [weight, setWeight] = useState(bodyWeightKg ?? 65);
  const [age, setAge] = useState(birthYear ? thisYear - birthYear : 30);

  return (
    <section className="card">
      <header>
        <h2>Three numbers and this screen works</h2>
        <p className="hint">
          Calorie needs are worked out from the Mifflin-St Jeor equation, which
          needs your height, your weight and your age. The app will not make one
          up: a guessed age moves the answer by over a hundred calories a day.
        </p>
      </header>

      {missing.includes('height') && (
        <label className="number-field">
          <span className="number-label">Height</span>
          <span className="number-input">
            <input
              type="number"
              inputMode="numeric"
              value={height}
              min={120}
              max={220}
              onChange={(event) => setHeight(Number(event.target.value))}
            />
            <span className="number-suffix">cm</span>
          </span>
        </label>
      )}

      {missing.includes('weight') && (
        <label className="number-field">
          <span className="number-label">Body weight</span>
          <span className="number-input">
            <input
              type="number"
              inputMode="decimal"
              value={weight}
              min={30}
              max={250}
              onChange={(event) => setWeight(Number(event.target.value))}
            />
            <span className="number-suffix">kg</span>
          </span>
        </label>
      )}

      {missing.includes('age') && (
        <label className="number-field">
          <span className="number-label">Age</span>
          <span className="number-input">
            <input
              type="number"
              inputMode="numeric"
              value={age}
              min={14}
              max={99}
              onChange={(event) => setAge(Number(event.target.value))}
            />
            <span className="number-suffix">years</span>
          </span>
        </label>
      )}

      <button
        type="button"
        className="btn btn-primary"
        onClick={async () => {
          if (missing.includes('height') && (!height || height < 120)) {
            showToast('Please enter a valid height.', 'warn');
            return;
          }
          if (missing.includes('weight') && (!weight || weight < 30)) {
            showToast('Please enter a valid body weight.', 'warn');
            return;
          }
          if (missing.includes('age') && (!age || age < 14)) {
            showToast('Please enter a valid age.', 'warn');
            return;
          }

          const changes: Record<string, unknown> = {};
          if (missing.includes('height')) changes.heightCm = height;
          if (missing.includes('age')) changes.birthYear = thisYear - age;
          await updateProfile(changes);
          // Weight goes through logWeight so it starts a trend line rather
          // than sitting on the profile as a number with no history.
          if (missing.includes('weight')) await logWeight(weight);
        }}
      >
        Work out my targets
      </button>
    </section>
  );
}

/**
 * One planned day, offered.
 *
 * Two of these appear on Fuel and they are not the same offer: the rest of
 * today, built against what is actually left, and a whole day, built against
 * the target from scratch. Both used to be one button that appended to the
 * log, which meant tapping it twice doubled her intake without saying so.
 * Here it writes once, remembers what it wrote, and offers to take it back.
 */
function PlanCard({
  title,
  hint,
  plan,
  date,
  hasLoggedFood,
  open,
  onToggle,
}: {
  title: string;
  hint: string;
  plan: DayPlan;
  date: string;
  hasLoggedFood: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const [written, setWritten] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const items = plan.meals.flatMap((meal) =>
    meal.items.map((item) => ({
      foodId: item.food.id,
      slot: meal.slot,
      servings: item.servings,
    })),
  );

  // Adding a whole day on top of a breakfast she has already logged is the
  // double-count bug wearing a different hat, so a whole-day plan replaces
  // the day and says so. A plan for what is left is additive by definition.
  const replaces = !plan.partial && hasLoggedFood;

  return (
    <section className="card">
      <header>
        <h2>{title}</h2>
        <p className="hint">{hint}</p>
      </header>

      <div className="plan-summary">
        <span className="pill">{Math.round(plan.totals.kcal)} kcal</span>
        <span className="pill">{Math.round(plan.totals.proteinG)} g protein</span>
        <span className="pill">{Math.round(plan.totals.fibreG)} g fibre</span>
      </div>

      <button type="button" className="link-btn" onClick={onToggle}>
        {open ? 'Hide the meals' : 'Show me the meals'}
      </button>

      {open && (
        <>
          {plan.meals.map((meal) => (
            <div key={meal.slot} className="meal-group">
              <h3 className="meal-slot">
                {SLOT_LABEL[meal.slot]}
                <span className="meal-slot-kcal">
                  {Math.round(meal.totals.kcal)} kcal ·{' '}
                  {Math.round(meal.totals.proteinG)} g P
                </span>
              </h3>
              {meal.items.map((item) => (
                <div key={item.food.id} className="meal-row static">
                  <span className="meal-name">
                    {item.food.name}
                    <span className="food-serving">
                      {item.servings} × {item.food.serving}
                    </span>
                  </span>
                  <span className="food-macros">
                    {Math.round(item.food.kcal * item.servings)} kcal
                  </span>
                </div>
              ))}
            </div>
          ))}

          {plan.notes.map((note) => (
            <p key={note} className="fineprint">
              {note}
            </p>
          ))}

          {written ? (
            <div className="added-note" role="status">
              <span className="added-text">
                <IconCheck size={16} />
                Added to today
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  await deleteMeals(written);
                  setWritten(null);
                }}
              >
                Undo
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                if (replaces) {
                  await replaceDayPlan(items, date);
                  // Nothing to undo to: the day it replaced is gone. Saying
                  // "added" with an Undo that could not restore what was
                  // there would be a lie in a button.
                  setWritten([]);
                } else {
                  setWritten(await logDayPlan(items, date));
                }
                setBusy(false);
              }}
            >
              {replaces
                ? 'Replace today with this'
                : plan.partial
                  ? 'Log the rest of my day'
                  : 'Log this whole day'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

type Panel = 'today' | 'plan' | 'targets';

export function FuelScreen() {
  const context = useLiveQuery(() => getNutritionContext(), []);
  const today = dateKey();
  const meals = useLiveQuery(() => getMealsFor(today), [today]);
  const [adding, setAdding] = useState(false);
  const [openPlan, setOpenPlan] = useState<'rest' | 'day' | null>(null);
  const [quickAddId, setQuickAddId] = useState<string | null>(null);

  /*
   * Three panels rather than one very long page.
   *
   * The screen was correct and unusable: the dial, the log, the plans, the
   * energy breakdown, two settings blocks and a BMI calculator, in one
   * column, so the thing she opens the app to do - add what she just ate -
   * sat above four screens of reference material she reads twice a year.
   * Today is the doing, Plan is the deciding, Targets is the arithmetic.
   */
  const [panel, setPanel] = useState<Panel>('today');

  useFocusEffect((focus) => {
    if (focus === 'add-food') {
      // Something else on another screen sent her here to log food, so put
      // her on the panel that does it as well as opening the picker.
      setPanel('today');
      setAdding(true);
    }
  });

  if (!context || !meals) return <p className="loading-note">Loading…</p>;
  const { profile, plan, missing, intakeToday, dayPlan, restOfDay, cuisine, usualFoods } =
    context;
  if (!profile) return null;

  if (!plan) {
    return (
      <>
        <header className="masthead">
          <p className="eyebrow">Fuel</p>
          <h1>What to eat</h1>
        </header>
        <SetupCard
          missing={missing}
          heightCm={profile.heightCm}
          bodyWeightKg={profile.bodyWeightKg}
          birthYear={profile.birthYear}
        />
        <p className="footnote">{NUTRITION_DISCLAIMER}</p>
      </>
    );
  }

  const eaten = roundNutrients(intakeToday ?? NO_NUTRIENTS);
  const remainingKcal = plan.target.kcal - eaten.kcal;
  const proteinShort = plan.macros.proteinG - eaten.proteinG;
  const pantry = allowedFoods(dietPatternOf(profile), foodAvoidOf(profile));
  // The meal a tap belongs to at this hour. The picker used to default to
  // lunch at eight in the morning, which is a wrong answer the app already
  // had the means to get right.
  const slotNow = slotForHour(new Date().getHours());

  const gapOptions =
    proteinShort > 5
      ? closeProteinGap({
          proteinShortG: proteinShort,
          kcalRemaining: remainingKcal,
          dietPattern: dietPatternOf(profile),
          avoid: foodAvoidOf(profile),
          cuisine,
        })
      : [];

  const bySlot = SLOT_ORDER.map((slot) => ({
    slot,
    entries: meals.filter((meal) => meal.slot === slot),
  })).filter((group) => group.entries.length > 0);

  /**
   * One tap, a standard serving, the meal that matches the hour.
   *
   * A food she wrote herself has to be re-logged with its macros attached,
   * because it lives on the row rather than in a table - logging just the id
   * would write her a name and no numbers.
   */
  const quickAdd = async (usual: UsualFood) => {
    setQuickAddId(usual.food.id);
    if (usual.custom) await logCustomMeal(usual.custom, slotNow, 1, today);
    else await logMeal(usual.food.id, slotNow, 1, today);
    setQuickAddId(null);
  };

  const tabs: { id: Panel; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'plan', label: 'Plan' },
    { id: 'targets', label: 'Targets' },
  ];

  return (
    <>
      <header className="masthead">
        <p className="eyebrow">Fuel</p>
        <h1>Today</h1>
        <p className="sub">
          {remainingKcal > 0
            ? `${Math.round(remainingKcal)} kcal left of ${plan.target.kcal}.`
            : `${Math.abs(Math.round(remainingKcal))} kcal past ${plan.target.kcal}. Not a problem on its own.`}
        </p>
      </header>

      <div className="segmented" role="tablist" aria-label="Fuel sections">
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

      {/* A floor she is under outranks every tab. It is the one thing on this
          screen that is about her health rather than her day. */}
      {plan.warnings.map((warning) => (
        <div key={warning} className="message warning">
          <p>{warning}</p>
        </div>
      ))}

      {panel === 'today' && (
        <>
          <section className="card">
            <DayDial
              eaten={eaten}
              targetKcal={plan.target.kcal}
              targetProteinG={plan.macros.proteinG}
            />

            {/* Four tiles rather than four full-width bars with their own
                headings. The same numbers in a quarter of the height, and the
                two that matter are already the rings above. */}
            <div className="macro-grid">
              <MacroTile label="Carbs" value={eaten.carbG} target={plan.macros.carbG} unit="g" />
              <MacroTile label="Fat" value={eaten.fatG} target={plan.macros.fatG} unit="g" />
              <MacroTile label="Fibre" value={eaten.fibreG} target={plan.macros.fibreG} unit="g" />
              <MacroTile label="Iron" value={eaten.ironMg} target={IRON_TARGET_MG} unit="mg" />
            </div>
          </section>

          {adding ? (
            <FoodPicker
              pantry={pantry}
              cuisine={cuisine}
              date={today}
              defaultSlot={slotNow}
              canEstimate={coachEnabled(profile)}
              onDone={() => setAdding(false)}
            />
          ) : (
            <section className="card">
              <header>
                <h2>Log something</h2>
                <p className="hint">
                  {usualFoods.length > 0
                    ? `One tap adds a standard serving to ${SLOT_LABEL[slotNow].toLowerCase()}.`
                    : 'A curated table that leads with the food you actually cook. Anything it does not have, you can write yourself.'}
                </p>
              </header>

              {usualFoods.length > 0 && (
                <div className="quick-add">
                  {usualFoods.map((usual) => (
                    <button
                      key={usual.food.id}
                      type="button"
                      className="quick-chip"
                      disabled={quickAddId === usual.food.id}
                      onClick={() => void quickAdd(usual)}
                    >
                      <IconPlus size={14} />
                      <span className="quick-name">{usual.food.name}</span>
                      <span className="quick-kcal">{usual.food.kcal}</span>
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => setAdding(true)}
              >
                {usualFoods.length > 0 ? 'Add something else' : 'Add food'}
              </button>
            </section>
          )}

          {gapOptions.length > 0 && (
            <section className="card">
              <header>
                <h2 className="with-icon">
                  <IconBolt size={19} />
                  {Math.round(proteinShort)} g of protein to go
                </h2>
                <p className="hint">
                  {remainingKcal > 0
                    ? 'The most protein per calorie you can eat, and one thing you actually cook. Tap one to log it.'
                    : 'You are at your calories already, so these take you over. Protein is the one worth going over on. Tap one to log it.'}
                </p>
              </header>
              <div className="food-list">
                {gapOptions.map((option) => (
                  <button
                    key={option.food.id}
                    type="button"
                    className="food-row"
                    disabled={quickAddId === option.food.id}
                    onClick={() => {
                      setQuickAddId(option.food.id);
                      void logMeal(option.food.id, slotNow, option.servings, today).then(
                        () => setQuickAddId(null),
                      );
                    }}
                  >
                    <span className="food-name">
                      {option.food.name}
                      <span className="food-serving">
                        {option.servings === 1
                          ? option.food.serving
                          : `${option.servings} × ${option.food.serving}`}
                      </span>
                    </span>
                    <span className="food-macros">
                      +{Math.round(option.adds.proteinG)} g protein
                      <span className="food-protein">
                        {Math.round(option.adds.kcal)} kcal
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {bySlot.length > 0 ? (
            <section className="card">
              <header>
                <h2>Logged today</h2>
                <p className="hint">
                  {meals.length} {meals.length === 1 ? 'item' : 'items'} ·{' '}
                  {Math.round(eaten.kcal)} kcal
                </p>
              </header>
              {bySlot.map((group) => {
                const slotTotals = roundNutrients(totalsForMeals(group.entries));
                return (
                  <div key={group.slot} className="meal-group">
                    <h3 className="meal-slot">
                      {SLOT_LABEL[group.slot]}
                      <span className="meal-slot-kcal">
                        {slotTotals.kcal} kcal · {slotTotals.proteinG} g P
                      </span>
                    </h3>
                    {group.entries.map((entry) => {
                      const food = foodFor(entry);
                      if (!food) return null;
                      return (
                        <div key={entry.id} className="meal-row">
                          <span className="meal-name">
                            <span className="meal-title">
                              {food.name}
                              {/* An estimate she accepted is still an
                                  estimate, and a day built out of them
                                  deserves to be marked rather than presented
                                  as measurement. */}
                              {entry.custom?.estimated && (
                                <span className="tag" title={ESTIMATE_CAVEAT}>
                                  estimate
                                </span>
                              )}
                            </span>
                            <span className="food-serving">
                              {entry.servings} × {food.serving} ·{' '}
                              {Math.round(food.kcal * entry.servings)} kcal
                            </span>
                          </span>
                          <span className="meal-actions">
                            <button
                              type="button"
                              className="stepper-btn"
                              aria-label={
                                entry.servings <= 0.5
                                  ? `Remove ${food.name}`
                                  : `Less ${food.name}`
                              }
                              onClick={() =>
                                void setMealServings(entry.id, entry.servings - 0.5)
                              }
                            >
                              −
                            </button>
                            <span className="meal-servings" aria-live="polite">
                              {entry.servings}
                            </span>
                            <button
                              type="button"
                              className="stepper-btn"
                              aria-label={`More ${food.name}`}
                              onClick={() =>
                                void setMealServings(entry.id, entry.servings + 0.5)
                              }
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => void deleteMeal(entry.id)}
                            >
                              Remove
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => void clearMealsFor(today)}
              >
                Clear today
              </button>
            </section>
          ) : (
            <p className="empty-note">
              Nothing logged today yet. Anything you add shows up here, meal by
              meal.
            </p>
          )}
        </>
      )}

      {panel === 'plan' && (
        <>
          {/* The rest of today comes first when there is a rest of today to
              plan. A whole day offered at six in the evening is a plan for a
              day that is nearly over. */}
          {restOfDay && (
            <PlanCard
              title="What is left of today"
              hint={`Built for the ${Math.round(restOfDay.targetKcal)} kcal and ${Math.round(
                restOfDay.targetProteinG,
              )} g of protein you still have, from the food you cook.`}
              plan={restOfDay}
              date={today}
              hasLoggedFood={meals.length > 0}
              open={openPlan === 'rest'}
              onToggle={() => setOpenPlan(openPlan === 'rest' ? null : 'rest')}
            />
          )}

          {dayPlan && (
            <PlanCard
              title="A whole day that hits your targets"
              hint={
                cuisine === null
                  ? 'Built from the same food table, adjusted to your numbers. A starting shape, not a rule.'
                  : `${CUISINE_LABEL[cuisine]} food, adjusted to your numbers. A starting shape, not a rule.`
              }
              plan={dayPlan}
              date={today}
              hasLoggedFood={meals.length > 0}
              open={openPlan === 'day'}
              onToggle={() => setOpenPlan(openPlan === 'day' ? null : 'day')}
            />
          )}

          <AskPanel
            title="Ask for a meal"
            hint="It knows your targets, what you have already eaten today and what you do not eat. Whatever it comes back with lands here as a card you can adjust and add."
            focus="meal"
            suggestions={[
              proteinShort > 5
                ? `Give me something with ${Math.round(proteinShort)} g of protein.`
                : 'Give me a dinner that fits what is left today.',
              'Something quick with what is probably in the house.',
              'Plan the rest of my day for me.',
            ]}
          />
        </>
      )}

      {panel === 'targets' && (
        <>
          <section className="card">
            <header>
              <h2>Where your target comes from</h2>
              <p className="hint">
                Every line is worked out from your height, weight, age and what
                you actually logged, never a lookup table.
              </p>
            </header>
            <div className="row">
              <div className="row-text">
                <div className="row-title">At rest</div>
                <div className="row-hint">What your body uses doing nothing at all</div>
              </div>
              <span className="pill">{plan.energy.bmr} kcal</span>
            </div>
            <div className="row">
              <div className="row-text">
                <div className="row-title">Plus daily life</div>
                <div className="row-hint">{ACTIVITY_HINT[activityLevelOf(profile)]}</div>
              </div>
              <span className="pill">{plan.energy.baselineKcal} kcal</span>
            </div>
            <div className="row">
              <div className="row-text">
                <div className="row-title">Plus training</div>
                <div className="row-hint">
                  Averaged from what you actually logged, not from the plan
                </div>
              </div>
              <span className="pill">+{plan.energy.trainingKcalPerDay} kcal</span>
            </div>
            <div className="row">
              <div className="row-text">
                <div className="row-title">Maintenance</div>
              </div>
              <span className="pill">{plan.energy.tdee} kcal</span>
            </div>
            <div className="row">
              <div className="row-text">
                <div className="row-title">Your target</div>
                <div className="row-hint">{GOAL_HINT[weightGoalOf(profile)]}</div>
              </div>
              <span className="pill good">{plan.target.kcal} kcal</span>
            </div>
            <div className="row">
              <div className="row-text">
                <div className="row-title">Protein</div>
              </div>
              <span className="pill">{plan.macros.proteinG} g</span>
            </div>
            <div className="row">
              <div className="row-text">
                <div className="row-title">Water</div>
              </div>
              <span className="pill">{(plan.waterMl / 1000).toFixed(1)} L</span>
            </div>
          </section>

          <section className="card">
            <header>
              <h2>What are you eating for?</h2>
            </header>
            <div className="chips">
              {(['lose', 'maintain', 'gain'] as WeightGoal[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`chip ${weightGoalOf(profile) === value ? 'selected' : ''}`}
                  aria-pressed={weightGoalOf(profile) === value}
                  onClick={() => void updateProfile({ weightGoal: value })}
                >
                  {GOAL_LABEL[value]}
                </button>
              ))}
            </div>

            <p className="scale-question">How active are your days outside training?</p>
            <div className="chips">
              {(['sedentary', 'light', 'moderate', 'active'] as ActivityLevel[]).map(
                (value) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip ${activityLevelOf(profile) === value ? 'selected' : ''}`}
                    aria-pressed={activityLevelOf(profile) === value}
                    onClick={() => void updateProfile({ activityLevel: value })}
                  >
                    {ACTIVITY_LABEL[value]}
                  </button>
                ),
              )}
            </div>
            <p className="fineprint">
              Training is counted separately, from your log. Most calculators bundle it
              into this setting and count it twice.
            </p>
          </section>

          <section className="card">
            <header>
              <h2>Iron</h2>
            </header>
            <p className="hint">{IRON_NOTE}</p>
          </section>

          <BmiCard heightCm={profile.heightCm} weightKg={profile.bodyWeightKg} />

          <p className="footnote">{NUTRITION_DISCLAIMER}</p>
        </>
      )}
    </>
  );
}


/** The BMI calculator, with the caveat attached rather than in a footnote. */
export function BmiCard({
  heightCm,
  weightKg,
}: {
  heightCm: number | null;
  weightKg: number | null;
}) {
  const [height, setHeight] = useState(heightCm ?? 165);
  const [weight, setWeight] = useState(weightKg ?? 65);
  const reading = readBmi(weight, height);

  return (
    <section className="card">
      <header>
        <h2>BMI</h2>
        <p className="hint">
          Change either number to work it out for a different weight or height.
          Nothing here is saved unless you save it.
        </p>
      </header>

      <div className="stepper-row">
        <label className="number-field">
          <span className="number-label">Height</span>
          <span className="number-input">
            <input
              type="number"
              inputMode="numeric"
              value={height}
              min={120}
              max={220}
              onChange={(event) => setHeight(Number(event.target.value))}
            />
            <span className="number-suffix">cm</span>
          </span>
        </label>
        <label className="number-field">
          <span className="number-label">Weight</span>
          <span className="number-input">
            <input
              type="number"
              inputMode="decimal"
              value={weight}
              min={30}
              max={250}
              onChange={(event) => setWeight(Number(event.target.value))}
            />
            <span className="number-suffix">kg</span>
          </span>
        </label>
      </div>

      {reading && (
        <>
          <div className={`bmi-readout band-${reading.band}`}>
            <span className="bmi-value">{reading.value}</span>
            <span className="bmi-label">{reading.label}</span>
          </div>
          <p className="hint">
            A BMI in the healthy range for {height} cm is {reading.healthyRangeKg[0]} to{' '}
            {reading.healthyRangeKg[1]} kg.
          </p>
        </>
      )}

      <p className="fineprint">{BMI_CAVEAT}</p>

      {(height !== heightCm || weight !== weightKg) && (
        <button
          type="button"
          className="btn btn-quiet"
          onClick={async () => {
            await updateProfile({ heightCm: height });
            if (weight !== weightKg) await logWeight(weight);
          }}
        >
          Save these as my numbers
        </button>
      )}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { logMeal } from '../../db/actions';
import { deleteMeal } from '../../db/actions';
import { searchFoods, type Food } from '../../domain/foods';
import { CUISINE_LABEL, type Cuisine } from '../../domain/cuisines';
import { CustomFoodForm } from './CustomFoodForm';
import { SLOT_LABEL, SLOT_ORDER } from '../../domain/meals';
import { IconCheck } from '../icons';
import type { MealSlot } from '../../db/schema';

/**
 * Adding food to the day.
 *
 * Search is a substring match over a curated table of a hundred and thirty
 * items, which is the whole reason this is usable: a barcode database returns
 * forty entries for "roti" and none of them are hers. It matches aliases as
 * well as names, because she types "lentils" and the table says "Daal".
 *
 * Three things were wrong with the first version and all three were the same
 * mistake - the screen knew something and did not say it.
 *
 *   - Tapping a food logged it and showed her nothing. No confirmation, no
 *     undo, and the list she was looking at did not move. So she tapped again.
 *   - The meal always defaulted to lunch, including at eight in the morning,
 *     and the app already had a function that turns an hour into a meal.
 *   - One tap meant exactly one serving. Two rotis is the single most common
 *     thing anyone logs, and it took three taps in two different places.
 */
export function FoodPicker({
  pantry,
  cuisine,
  date,
  defaultSlot,
  canEstimate,
  initialQuery = '',
  onDone,
}: {
  /** Already filtered to her diet and exclusions by the caller. */
  pantry: Food[];
  cuisine: Cuisine | null;
  date: string;
  defaultSlot: MealSlot;
  /** Pre-filled search, for a link that opens the picker on one thing. */
  initialQuery?: string;
  /** She has opted into the coach, so an estimate may leave the device. */
  canEstimate: boolean;
  onDone: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const card = useRef<HTMLElement>(null);

  // Opened from a link further down the page - "log a shake or bar" - the
  // picker replaces a card above the fold, and she is left looking at the
  // place she tapped with nothing apparently having happened.
  useEffect(() => {
    if (initialQuery !== '') card.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [initialQuery]);
  const [slot, setSlot] = useState<MealSlot>(defaultSlot);
  const [servings, setServings] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [writingOwn, setWritingOwn] = useState(false);
  /**
   * The last thing added, so it can be confirmed and - for a one-tap add -
   * taken back. A custom food carries no id here because a mis-tap is not
   * how it goes wrong; she typed it, and the day's list below removes it.
   */
  const [justAdded, setJustAdded] = useState<{
    id: string | null;
    food: Pick<Food, 'name'>;
    servings: number;
    slot: MealSlot;
  } | null>(null);

  const results = useMemo(
    () => searchFoods(pantry, query, cuisine).slice(0, 40),
    [pantry, query, cuisine],
  );

  const add = async (food: Food) => {
    setBusyId(food.id);
    const row = await logMeal(food.id, slot, servings, date);
    setBusyId(null);
    setJustAdded({ id: row.id, food, servings, slot });
    // The portion is deliberately not reset. Logging two rotis is usually
    // followed by logging another two of something.
  };

  return (
    <section className="card" ref={card}>
      <header>
        <h2>Add food</h2>
        <p className="hint">
          Pick the meal and the portion once, then tap as many foods as you
          like. Everything lands on today&rsquo;s list, where you can still
          change it.
        </p>
      </header>

      <div className="chips">
        {SLOT_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            className={`chip ${slot === option ? 'selected' : ''}`}
            aria-pressed={slot === option}
            onClick={() => setSlot(option)}
          >
            {SLOT_LABEL[option]}
          </button>
        ))}
      </div>

      <div className="portion-row">
        <span className="portion-label">Portions</span>
        <span className="portion-stepper">
          <button
            type="button"
            className="stepper-btn"
            aria-label="Smaller portion"
            disabled={servings <= 0.5}
            onClick={() => setServings(Math.max(0.5, servings - 0.5))}
          >
            −
          </button>
          <span className="portion-value" aria-live="polite">
            {servings}
          </span>
          <button
            type="button"
            className="stepper-btn"
            aria-label="Bigger portion"
            disabled={servings >= 6}
            onClick={() => setServings(Math.min(6, servings + 0.5))}
          >
            +
          </button>
        </span>
      </div>

      <label className="search-field">
        <span className="sr-only">Search foods</span>
        <input
          type="search"
          value={query}
          placeholder="Search: roti, lentils, chicken"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {justAdded && (
        <div className="added-note" role="status">
          <span className="added-text">
            <IconCheck size={16} />
            {justAdded.servings} × {justAdded.food.name} to{' '}
            {SLOT_LABEL[justAdded.slot].toLowerCase()}
          </span>
          {justAdded.id !== null && (
            <button
              type="button"
              className="link-btn"
              onClick={async () => {
                await deleteMeal(justAdded.id!);
                setJustAdded(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {query.trim() === '' && cuisine !== null && (
        <p className="fineprint">
          {CUISINE_LABEL[cuisine]} food first, because that is where you said
          you cook. Everything else is still here. Search for it.
        </p>
      )}

      <div className="food-list">
        {results.map((food) => (
          <button
            key={food.id}
            type="button"
            className="food-row"
            disabled={busyId === food.id}
            onClick={() => void add(food)}
          >
            <span className="food-name">
              {food.name}
              <span className="food-serving">
                {servings === 1 ? food.serving : `${servings} × ${food.serving}`}
              </span>
            </span>
            <span className="food-macros">
              {Math.round(food.kcal * servings)} kcal
              <span className="food-protein">
                {Math.round(food.proteinG * servings * 10) / 10} g protein
              </span>
            </span>
          </button>
        ))}
        {results.length === 0 && (
          <p className="hint">
            Nothing matches that. The table is curated rather than exhaustive, so
            pick the closest thing, or write your own below.
          </p>
        )}
      </div>

      {/* Always offered, not only when the search comes back empty. She
          often knows before she types that her dinner is not going to be in
          anybody’s food table, and making her prove it first is a search
          box used as a toll gate. */}
      {writingOwn ? (
        <CustomFoodForm
          slot={slot}
          servings={servings}
          date={date}
          canEstimate={canEstimate}
          onCancel={() => setWritingOwn(false)}
          onDone={(food) => {
            setWritingOwn(false);
            setJustAdded({
              // The row id is not needed to confirm it: the log below is
              // live and she can remove it there. Undo is offered only for
              // the one-tap adds, where a mis-tap is the likely mistake.
              id: null,
              food: { name: food.name } as Pick<Food, 'name'>,
              servings,
              slot,
            });
          }}
        />
      ) : (
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => setWritingOwn(true)}
        >
          Not in the list? Add it yourself
        </button>
      )}

      <button type="button" className="btn btn-quiet" onClick={onDone}>
        Done
      </button>
    </section>
  );
}

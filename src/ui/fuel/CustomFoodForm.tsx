import { useState } from 'react';
import { logCustomMeal } from '../../db/actions';
import { useToast } from '../ToastProvider';
import { boundCustomFood, ESTIMATE_CAVEAT } from '../../domain/estimate';
import { estimateAvailable, estimateFood } from '../../lib/estimateClient';
import { SLOT_LABEL } from '../../domain/meals';
import { IconSpark } from '../icons';
import type { CustomFood, MealSlot } from '../../db/schema';

/**
 * Logging something the table does not have.
 *
 * A curated table is why the search is usable and it is also why it will
 * never contain her mother's biryani or the wrap from the place by the
 * station. The usual answer to that is a barcode database, which trades one
 * unusable list for a larger one. This is the other answer: let her write the
 * row.
 *
 * Two ways in, and the order matters. If she knows the numbers - a label, a
 * packet, a recipe app - typing them is faster than any conversation, so that
 * is the form she lands on. If she does not, she describes the plate and a
 * model guesses, which is worth doing because the real alternative is not a
 * better number, it is a hole in the day. The guess arrives in the same
 * fields she would have typed, editable, and nothing is written until she
 * taps Add - the same contract as the coach's meal cards.
 */
export function CustomFoodForm({
  slot,
  servings,
  date,
  canEstimate,
  onDone,
  onCancel,
}: {
  slot: MealSlot;
  servings: number;
  date: string;
  /** She has opted into the coach, so a request may leave the device. */
  canEstimate: boolean;
  onDone: (food: CustomFood) => void;
  onCancel: () => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [serving, setServing] = useState('');
  const [kcal, setKcal] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [carbG, setCarbG] = useState('');
  const [fatG, setFatG] = useState('');
  const [fibreG, setFibreG] = useState('');
  const [detail, setDetail] = useState(false);

  const [description, setDescription] = useState('');
  const [guessing, setGuessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once a guess has filled the fields, so the card can say it was one. */
  const [estimated, setEstimated] = useState(false);

  const offerEstimate = canEstimate && estimateAvailable();

  const food = boundCustomFood({
    name,
    serving,
    kcal: Number(kcal),
    proteinG: Number(proteinG),
    carbG: Number(carbG),
    fatG: Number(fatG),
    fibreG: Number(fibreG),
    estimated,
  });

  async function guess() {
    setGuessing(true);
    setError(null);
    const result = await estimateFood(description);
    setGuessing(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    // Straight into the fields rather than into the log. She sees every
    // number before it is hers, and what she edits is what gets written.
    const guessed = result.estimate;
    setName(guessed.name);
    setServing(guessed.serving);
    setKcal(String(guessed.kcal));
    setProteinG(String(guessed.proteinG));
    setCarbG(String(guessed.carbG));
    setFatG(String(guessed.fatG));
    setFibreG(String(guessed.fibreG));
    setEstimated(true);
    setDetail(true);
  }

  return (
    <div className="custom-food">
      <h3 className="custom-title">Add something the app does not have</h3>

      {offerEstimate && (
        <div className="estimate-box">
          <label className="estimate-label" htmlFor="estimate-input">
            Do not know the numbers? Describe it.
          </label>
          <textarea
            id="estimate-input"
            className="estimate-input"
            rows={2}
            value={description}
            placeholder="A chicken shawarma wrap with garlic sauce and chips"
            onChange={(event) => setDescription(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={guessing || description.trim() === ''}
            onClick={() => void guess()}
          >
            <IconSpark size={16} />
            {guessing ? 'Working it out…' : 'Estimate it for me'}
          </button>
          <p className="fineprint">
            This is the one part of the food log that sends anything over the
            internet: just the sentence you typed, nothing else about you.
            Describe one portion; the portion count above multiplies it.
          </p>
        </div>
      )}

      {!offerEstimate && (
        <p className="fineprint">
          Turn the coach on in You and the app can estimate these from a
          description when you do not know them.
        </p>
      )}

      {error && (
        <div className="message warning">
          <p>{error}</p>
        </div>
      )}

      {estimated && (
        <div className="message note">
          <p>{ESTIMATE_CAVEAT}</p>
        </div>
      )}

      <label className="text-field">
        <span className="number-label">What was it?</span>
        <input
          type="text"
          value={name}
          maxLength={60}
          placeholder="Mum’s biryani"
          onChange={(event) => {
            setName(event.target.value);
            // Editing after a guess is still a guess unless she cleared it,
            // so the flag stays. She is correcting an estimate, not measuring.
          }}
        />
      </label>

      <label className="text-field">
        <span className="number-label">One portion is</span>
        <input
          type="text"
          value={serving}
          maxLength={40}
          placeholder="a bowl"
          onChange={(event) => setServing(event.target.value)}
        />
      </label>

      <div className="stepper-row">
        <label className="number-field">
          <span className="number-label">Calories</span>
          <span className="number-input">
            <input
              type="number"
              inputMode="numeric"
              value={kcal}
              min={0}
              max={2000}
              placeholder=""
              onChange={(event) => setKcal(event.target.value)}
            />
            <span className="number-suffix">kcal</span>
          </span>
        </label>
        <label className="number-field">
          <span className="number-label">Protein</span>
          <span className="number-input">
            <input
              type="number"
              inputMode="decimal"
              value={proteinG}
              min={0}
              max={200}
              placeholder=""
              onChange={(event) => setProteinG(event.target.value)}
            />
            <span className="number-suffix">g</span>
          </span>
        </label>
      </div>

      {/* Carbohydrate, fat and fibre are folded away because requiring them
          is how a quick log becomes a form she abandons. The day's carb, fat
          and fibre bars simply count nothing for a row that left them out,
          which is honest: she did not say. */}
      <button
        type="button"
        className="link-btn"
        onClick={() => setDetail(!detail)}
      >
        {detail ? 'Hide the rest' : 'Add carbs, fat and fibre'}
      </button>

      {detail && (
        <div className="stepper-row">
          <label className="number-field">
            <span className="number-label">Carbs</span>
            <span className="number-input">
              <input
                type="number"
                inputMode="decimal"
                value={carbG}
                min={0}
                max={300}
                placeholder=""
                onChange={(event) => setCarbG(event.target.value)}
              />
              <span className="number-suffix">g</span>
            </span>
          </label>
          <label className="number-field">
            <span className="number-label">Fat</span>
            <span className="number-input">
              <input
                type="number"
                inputMode="decimal"
                value={fatG}
                min={0}
                max={200}
                placeholder=""
                onChange={(event) => setFatG(event.target.value)}
              />
              <span className="number-suffix">g</span>
            </span>
          </label>
          <label className="number-field">
            <span className="number-label">Fibre</span>
            <span className="number-input">
              <input
                type="number"
                inputMode="decimal"
                value={fibreG}
                min={0}
                max={80}
                placeholder=""
                onChange={(event) => setFibreG(event.target.value)}
              />
              <span className="number-suffix">g</span>
            </span>
          </label>
        </div>
      )}

      <div className="custom-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            if (!food) {
              if (name.trim() === '') showToast('Please enter a name for the food.', 'warn');
              else if (kcal === '') showToast('Please enter the calories.', 'warn');
              else showToast('Please check the food details.', 'warn');
              return;
            }
            await logCustomMeal(food, slot, servings, date);
            onDone(food);
            showToast(`Added ${food.name} to your log.`, 'ok');
          }}
        >
          Add to {SLOT_LABEL[slot].toLowerCase()}
        </button>
      </div>

      {food === null && (name.trim() !== '' || kcal !== '') && (
        <p className="fineprint">A name and a calorie figure are the two it needs.</p>
      )}
    </div>
  );
}

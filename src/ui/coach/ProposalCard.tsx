import { useState } from 'react';
import {
  acceptLogProposal,
  acceptMealProposal,
  acceptSessionProposal,
} from '../../db/actions';
import type { TodayProposalContext } from '../../db/derived';
import { SLOT_LABEL, SLOT_ORDER } from '../../domain/meals';
import {
  clampServings,
  parseProposal,
  proposalKind,
  splitProposal,
  totalsOfItems,
  type LogProposal,
  type MealProposal,
  type Proposal,
  type SessionProposal,
} from '../../domain/proposals';
import { getExercise, isBodyweight, isTimed } from '../../domain/exercises';
import { getFood } from '../../domain/foods';
import type { ChatMessage, MealSlot } from '../../db/schema';
import { useNav } from '../nav';
import type { DayBudget } from './useProposalContext';

/**
 * What the coach offered, as something she can change and then accept.
 *
 * Three rules hold this component together.
 *
 * Nothing is written until she taps. The card is a draft; her log is not.
 *
 * What she edits is what gets written. The rows below start from the model's
 * reply and stop being it the moment she takes a roti off the plate - so the
 * apply handler sends the state of this component, never the parsed proposal.
 *
 * Every number on it is computed here from the food table. The model chose
 * which foods; it did not get to say what they add up to, and if it wrote a
 * different figure in its prose the card quietly disagrees with it.
 */

function Receipt({ children }: { children: React.ReactNode }) {
  return (
    <div className="proposal applied">
      <p className="proposal-receipt">{children}</p>
    </div>
  );
}

/* --------------------------------- food --------------------------------- */

interface Row {
  foodId: string;
  slot: MealSlot;
  servings: number;
}

function MealCard({
  messageId,
  proposal,
  budget,
  applied,
}: {
  messageId: string;
  proposal: MealProposal;
  budget: DayBudget | null;
  applied: boolean;
}) {
  const nav = useNav();
  const [rows, setRows] = useState<Row[]>(() =>
    proposal.items.map((item) => ({
      foodId: item.food.id,
      slot: item.slot,
      servings: item.servings,
    })),
  );
  const [busy, setBusy] = useState(false);

  if (applied) {
    return (
      <Receipt>
        Added to today’s log.{' '}
        <button type="button" className="link-btn" onClick={() => nav.go('fuel')}>
          See it on Fuel
        </button>
      </Receipt>
    );
  }

  const items = rows.flatMap((row) => {
    const food = getFood(row.foodId);
    return food ? [{ food, servings: row.servings, slot: row.slot }] : [];
  });
  const totals = totalsOfItems(items);

  const setServings = (index: number, servings: number) =>
    setRows((current) =>
      servings <= 0
        ? current.filter((_, i) => i !== index)
        : current.map((row, i) =>
            i === index ? { ...row, servings: clampServings(servings) } : row,
          ),
    );

  const groups = SLOT_ORDER.map((slot) => ({
    slot,
    rows: rows.map((row, index) => ({ row, index })).filter((entry) => entry.row.slot === slot),
  })).filter((group) => group.rows.length > 0);

  return (
    <div className="proposal">
      <p className="proposal-head">The coach can add this for you</p>

      {groups.map((group) => (
        <div key={group.slot} className="meal-group">
          <h4 className="meal-slot">{SLOT_LABEL[group.slot as MealSlot]}</h4>
          {group.rows.map(({ row, index }) => {
            const food = getFood(row.foodId);
            if (!food) return null;
            return (
              <div key={`${row.foodId}-${row.slot}`} className="meal-row">
                <span className="meal-name">
                  {food.name}
                  <span className="food-serving">
                    {row.servings} × {food.serving}
                  </span>
                  <span className="food-serving">
                    {Math.round(food.kcal * row.servings)} kcal ·{' '}
                    {Math.round(food.proteinG * row.servings)} g protein
                  </span>
                </span>
                <span className="meal-actions">
                  <button
                    type="button"
                    className="stepper-btn"
                    aria-label={`Less ${food.name}`}
                    onClick={() => setServings(index, row.servings - 0.5)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="stepper-btn"
                    aria-label={`More ${food.name}`}
                    onClick={() => setServings(index, row.servings + 0.5)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setServings(index, 0)}
                  >
                    Remove
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {rows.length === 0 ? (
        <p className="hint">
          You have taken everything off this one. Ask for another and it will land here.
        </p>
      ) : (
        <>
          <p className="proposal-totals">
            {Math.round(totals.kcal)} kcal · {Math.round(totals.proteinG)} g protein ·{' '}
            {Math.round(totals.carbG)} g carbs · {Math.round(totals.fatG)} g fat
          </p>
          {budget && (
            <p className="hint">
              That would put you at {Math.round(budget.kcalEaten + totals.kcal)} of{' '}
              {budget.kcalTarget} kcal and{' '}
              {Math.round(budget.proteinEatenG + totals.proteinG)} of{' '}
              {Math.round(budget.proteinTargetG)} g protein today.
            </p>
          )}
        </>
      )}

      {proposal.dropped.length > 0 && (
        <p className="fineprint">
          Left out: {proposal.dropped.join(', ')}. Not in the food table, or not
          something you eat. Nothing was guessed in its place.
        </p>
      )}

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || rows.length === 0}
          onClick={async () => {
            setBusy(true);
            await acceptMealProposal(
              messageId,
              rows.map((row) => ({
                foodId: row.foodId,
                slot: row.slot,
                servings: row.servings,
              })),
            );
            setBusy(false);
          }}
        >
          Add to today’s log
        </button>
      </div>
      <p className="fineprint">
        Change the portions here, or tell the coach what to swap and it will send
        another. Nothing is logged until you tap.
      </p>
    </div>
  );
}

/* ------------------------------- training ------------------------------- */

function SessionCard({
  messageId,
  proposal,
  applied,
}: {
  messageId: string;
  proposal: SessionProposal;
  applied: boolean;
}) {
  const [chosen, setChosen] = useState<string[]>(() =>
    proposal.swaps.map((swap) => swap.slotKey),
  );
  const [busy, setBusy] = useState(false);

  if (applied) {
    return <Receipt>Swapped. Today’s session has been updated.</Receipt>;
  }

  return (
    <div className="proposal">
      <p className="proposal-head">The coach can change today’s session</p>

      {proposal.swaps.map((swap) => {
        const on = chosen.includes(swap.slotKey);
        return (
          <label key={swap.slotKey} className="swap-row">
            <input
              type="checkbox"
              checked={on}
              onChange={() =>
                setChosen((current) =>
                  on
                    ? current.filter((key) => key !== swap.slotKey)
                    : [...current, swap.slotKey],
                )
              }
            />
            <span className="swap-text">
              <span className="swap-to">{swap.to.name}</span>
              <span className="swap-from">instead of {swap.from.name}</span>
            </span>
          </label>
        );
      })}

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || chosen.length === 0}
          onClick={async () => {
            setBusy(true);
            await acceptSessionProposal(
              messageId,
              proposal.swaps
                .filter((swap) => chosen.includes(swap.slotKey))
                .map((swap) => ({ slotKey: swap.slotKey, exerciseId: swap.to.id })),
            );
            setBusy(false);
          }}
        >
          {chosen.length > 1 ? 'Use these instead' : 'Use this instead'}
        </button>
      </div>
      <p className="fineprint">
        Your sets, reps and weights are worked out from your log and do not change.
        A swap sticks for this slot next time too. The exercise card on Today
        changes it back.
      </p>
    </div>
  );
}

/* ------------------------------ logging sets ----------------------------- */

interface LogRow {
  exerciseId: string;
  weightKg: number;
  reps: number;
  sets: number;
  rir: number | null;
}

function LogCard({
  messageId,
  proposal,
  templateId,
  applied,
}: {
  messageId: string;
  proposal: LogProposal;
  templateId: string | null;
  applied: boolean;
}) {
  const [rows, setRows] = useState<LogRow[]>(() =>
    proposal.sets.map((set) => ({
      exerciseId: set.exercise.id,
      weightKg: set.weightKg,
      reps: set.reps,
      sets: set.sets,
      rir: set.rir,
    })),
  );
  const [busy, setBusy] = useState(false);

  if (applied) {
    return <Receipt>Logged. It is in today’s session.</Receipt>;
  }

  const edit = (index: number, changes: Partial<LogRow>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...changes } : row)),
    );

  const total = rows.reduce((sum, row) => sum + row.sets, 0);

  return (
    <div className="proposal">
      <p className="proposal-head">The coach can log this for you</p>

      {rows.map((row, index) => {
        const exercise = getExercise(row.exerciseId);
        if (!exercise) return null;
        const timed = isTimed(exercise);
        const bodyweight = isBodyweight(exercise);

        return (
          <div key={`${row.exerciseId}-${index}`} className="log-row">
            <div className="log-row-head">
              <span className="log-name">{exercise.name}</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>

            <div className="log-fields">
              {!bodyweight && (
                <LogField
                  label="Weight"
                  value={row.weightKg}
                  suffix="kg"
                  step={exercise.incrementKg || 2.5}
                  min={0}
                  onChange={(weightKg) => edit(index, { weightKg })}
                />
              )}
              <LogField
                label={timed ? 'Seconds' : 'Reps'}
                value={row.reps}
                step={timed ? 5 : 1}
                min={1}
                onChange={(reps) => edit(index, { reps })}
              />
              <LogField
                label="Sets"
                value={row.sets}
                step={1}
                min={1}
                onChange={(sets) => edit(index, { sets })}
              />
            </div>
          </div>
        );
      })}

      {proposal.dropped.length > 0 && (
        <p className="fineprint">
          Left out: {proposal.dropped.join(', ')}. Not an exercise the app knows.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="hint">Nothing left on this one. Tell the coach again if you meant to.</p>
      ) : (
        <>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await acceptLogProposal(messageId, rows, templateId);
                setBusy(false);
              }}
            >
              Log {total} {total === 1 ? 'set' : 'sets'}
            </button>
          </div>
          <p className="fineprint">
            Check the numbers before you tap. These become your training history,
            and next week&rsquo;s weights are worked out from them.
          </p>
        </>
      )}
    </div>
  );
}

function LogField({
  label,
  value,
  suffix,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  step: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="log-field">
      <span className="stepper-label">{label}</span>
      <div className="stepper-control">
        <button
          type="button"
          className="stepper-btn"
          aria-label={`Decrease ${label}`}
          disabled={value - step < min}
          onClick={() => onChange(Math.round((value - step) * 100) / 100)}
        >
          −
        </button>
        <span className="stepper-value">
          {value}
          {suffix ? ` ${suffix}` : ''}
        </span>
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

/**
 * The card attached to one reply, if it has one.
 *
 * Both the coach thread and the ask boxes render replies straight from the
 * stored conversation, so the block is parsed here rather than in three
 * places - and so the "she already accepted this" case is handled once.
 */
const RECEIPT: Record<Proposal['kind'], string> = {
  meal: 'Added to today’s log.',
  session: 'Swapped. Today’s session has been updated.',
  log: 'Logged. It is in today’s session.',
};

export function MessageProposal({
  message,
  context,
  budget,
}: {
  message: ChatMessage;
  /** Null while the live query that supplies it is still resolving. */
  context: TodayProposalContext | null;
  budget: DayBudget | null;
}) {
  if (message.role !== 'assistant' || message.failed) return null;

  const { raw } = splitProposal(message.content);
  if (raw === null) return null;

  const applied = Boolean(message.appliedAt);
  const proposal = context ? parseProposal(raw, context) : null;

  if (!proposal) {
    // Either the context has not loaded yet, or the proposal no longer
    // validates - which is exactly what accepting a swap does to it.
    if (!applied) return null;
    const kind = proposalKind(raw);
    return <Receipt>{kind ? RECEIPT[kind] : RECEIPT.meal}</Receipt>;
  }

  if (proposal.kind === 'meal') {
    return (
      <MealCard
        messageId={message.id}
        proposal={proposal}
        budget={budget}
        applied={applied}
      />
    );
  }

  if (proposal.kind === 'log') {
    return (
      <LogCard
        messageId={message.id}
        proposal={proposal}
        templateId={context?.templateId ?? null}
        applied={applied}
      />
    );
  }

  return <SessionCard messageId={message.id} proposal={proposal} applied={applied} />;
}

import { db } from './db';
import { create, patch, remove, updateProfile } from './repo';
import { getOpenSession } from './queries';
import { dateKey } from '../lib/date';
import { customFoodId } from '../domain/foods';
import type {
  BodyMetric,
  ChatMessage,
  ChatRole,
  Checkin,
  CoachNote,
  CoachNoteKind,
  ConditioningLog,
  ConditioningModality,
  CustomFood,
  CycleEvent,
  CycleEventKind,
  MealLog,
  MealSlot,
  Session,
  SetLog,
  SymptomTag,
} from './schema';

/** Every mutation the training UI performs, in one place. */

export async function startSession(templateId: string | null): Promise<Session> {
  const open = await getOpenSession();
  if (open) return open;

  return create<Session>(db.sessions, {
    startedAt: Date.now(),
    endedAt: null,
    templateId,
    notes: null,
  });
}

export async function finishSession(sessionId: string): Promise<void> {
  const [sets, conditioning] = await Promise.all([
    db.sets.where('sessionId').equals(sessionId).count(),
    db.conditioning.filter((row) => row.sessionId === sessionId).count(),
  ]);

  // An abandoned session with nothing logged should not count as training, and
  // should not advance the program rotation. A conditioning day logs no sets
  // at all, so counting only sets would delete every completed cardio session
  // and leave the hybrid rotation stuck on the same day forever.
  if (sets === 0 && conditioning === 0) {
    await remove(db.sessions, sessionId);
    return;
  }

  const now = Date.now();
  await db.sessions.update(sessionId, { endedAt: now, updatedAt: now });
}

/** Discards an in-progress session and everything logged into it. */
export async function abandonSession(sessionId: string): Promise<void> {
  const [sets, conditioning] = await Promise.all([
    db.sets.where('sessionId').equals(sessionId).toArray(),
    db.conditioning.filter((row) => row.sessionId === sessionId).toArray(),
  ]);
  await Promise.all([
    ...sets.map((set) => remove(db.sets, set.id)),
    ...conditioning.map((row) => remove(db.conditioning, row.id)),
  ]);
  await remove(db.sessions, sessionId);
}

export interface SetInput {
  weightKg: number;
  reps: number;
  rir: number | null;
}

export async function logSet(
  sessionId: string,
  exerciseId: string,
  input: SetInput,
): Promise<SetLog> {
  return create<SetLog>(db.sets, {
    sessionId,
    exerciseId,
    performedAt: Date.now(),
    weightKg: input.weightKg,
    reps: input.reps,
    rir: input.rir,
    isWarmup: false,
  });
}

export async function deleteSet(setId: string): Promise<void> {
  await remove(db.sets, setId);
}

/* ------------------------------ check-ins ------------------------------ */

export interface CheckinInput {
  sleep: number;
  energy: number;
  soreness: number;
  symptoms: SymptomTag[];
}

/**
 * One check-in per day. The date index is unique, so re-answering has to patch
 * the existing row rather than insert a second one.
 */
export async function saveCheckin(
  input: CheckinInput,
  date = dateKey(),
): Promise<Checkin> {
  const existing = await db.checkins.where('date').equals(date).first();
  if (existing) {
    await patch(db.checkins, existing.id, input);
    return { ...existing, ...input, updatedAt: Date.now() };
  }
  return create<Checkin>(db.checkins, { date, ...input });
}

export async function clearTodaysCheckin(): Promise<void> {
  const existing = await db.checkins.where('date').equals(dateKey()).first();
  if (existing) await remove(db.checkins, existing.id);
}

/* ------------------------------ readiness ------------------------------ */

/** She was offered a lighter session and chose the full weight anyway. */
export async function setReadinessOverride(
  sessionId: string,
  overridden: boolean,
): Promise<void> {
  await patch(db.sessions, sessionId, { readinessOverride: overridden });
}

export async function setReadinessAdjustments(value: 'on' | 'off'): Promise<void> {
  await updateProfile({ readinessAdjustments: value });
}

/** Remembers a swapped exercise for this slot in future sessions. */
export async function swapExercise(slotKey: string, exerciseId: string): Promise<void> {
  await swapExercises([{ slotKey, exerciseId }]);
}

/**
 * Several swaps at once, as one write.
 *
 * Looping over swapExercise instead would read the profile once per swap and
 * write back a map built from a stale copy, so a coach proposal that changed
 * two slots would reliably apply only the last of them.
 */
export async function swapExercises(
  swaps: { slotKey: string; exerciseId: string }[],
): Promise<void> {
  if (swaps.length === 0) return;
  const profile = await db.profile.get('profile');
  const overrides = { ...(profile?.exerciseOverrides ?? {}) };
  for (const swap of swaps) overrides[swap.slotKey] = swap.exerciseId;
  await updateProfile({ exerciseOverrides: overrides });
}

/* ---------------------------- conditioning ---------------------------- */

export interface ConditioningInput {
  modality: ConditioningModality;
  kind: 'easy' | 'intervals';
  minutes: number;
  rpe: number;
  distanceKm: number | null;
  rounds: number | null;
  workSeconds: number | null;
  restSeconds: number | null;
}

export async function logConditioning(
  input: ConditioningInput,
  sessionId: string | null = null,
  date = dateKey(),
): Promise<ConditioningLog> {
  return create<ConditioningLog>(db.conditioning, { ...input, sessionId, date });
}

export async function deleteConditioning(id: string): Promise<void> {
  await remove(db.conditioning, id);
}

/* ------------------------------- cycle ------------------------------- */

/**
 * Logging the same event twice on the same day is a mis-tap, not a second
 * period, so it toggles the existing row off instead of adding another. That
 * also gives the calendar a single obvious way to undo an entry.
 */
export async function logCycleEvent(
  kind: CycleEventKind,
  date = dateKey(),
): Promise<void> {
  const existing = await db.cycleEvents.where('date').equals(date).toArray();
  const match = existing.find(
    (event) => event.kind === kind && event.deletedAt === null,
  );
  if (match) {
    await remove(db.cycleEvents, match.id);
    return;
  }
  await create<CycleEvent>(db.cycleEvents, { date, kind });
}

export async function setCycleTracking(
  value: 'track' | 'contraception' | 'off',
): Promise<void> {
  await updateProfile({ cycleTracking: value });
}

/* -------------------------------- body -------------------------------- */

/**
 * One weigh-in per day, and the profile's body weight follows the newest one.
 *
 * The profile copy exists because starting weights and calorie targets read it
 * constantly; keeping it in step here means there is still only one place the
 * value is actually decided.
 */
export async function logWeight(
  weightKg: number,
  options: { waistCm?: number | null; note?: string | null; date?: string } = {},
): Promise<void> {
  const date = options.date ?? dateKey();
  const existing = await db.bodyMetrics.where('date').equals(date).first();

  if (existing) {
    await patch(db.bodyMetrics, existing.id, {
      weightKg,
      waistCm: options.waistCm ?? existing.waistCm,
      note: options.note ?? existing.note,
    });
  } else {
    await create<BodyMetric>(db.bodyMetrics, {
      date,
      weightKg,
      waistCm: options.waistCm ?? null,
      note: options.note ?? null,
    });
  }

  const latest = (await db.bodyMetrics.toArray())
    .filter((row) => row.deletedAt === null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  if (latest) await updateProfile({ bodyWeightKg: latest.weightKg });
}

export async function deleteWeight(id: string): Promise<void> {
  await remove(db.bodyMetrics, id);
}

/* ------------------------------ nutrition ------------------------------ */

export async function logMeal(
  foodId: string,
  slot: MealSlot,
  servings = 1,
  date = dateKey(),
): Promise<MealLog> {
  return create<MealLog>(db.meals, { date, slot, foodId, servings });
}

/**
 * Something she ate that the table does not have.
 *
 * The food is written onto the row rather than into a table of her own, so
 * correcting a dish next month cannot rewrite what last month says she ate.
 * The id is a slug of the name, which is what lets the quick-add row notice
 * she keeps logging the same thing.
 */
export async function logCustomMeal(
  food: CustomFood,
  slot: MealSlot,
  servings = 1,
  date = dateKey(),
): Promise<MealLog> {
  return create<MealLog>(db.meals, {
    date,
    slot,
    foodId: customFoodId(food.name),
    servings,
    custom: food,
  });
}

export async function setMealServings(id: string, servings: number): Promise<void> {
  if (servings <= 0) {
    await remove(db.meals, id);
    return;
  }
  await patch(db.meals, id, { servings });
}

export async function deleteMeal(id: string): Promise<void> {
  await remove(db.meals, id);
}

/**
 * Copies a generated day plan into the log, so she can adjust from there.
 *
 * Returns the rows it wrote. The screen keeps them so the button can turn
 * into "Undo" rather than staying an offer to do it again: without that,
 * tapping "log this day" twice silently doubled her intake, and the only
 * clue was a calorie total that had quietly gone wrong.
 */
export async function logDayPlan(
  items: { foodId: string; slot: MealSlot; servings: number }[],
  date = dateKey(),
): Promise<string[]> {
  const ids: string[] = [];
  await db.transaction('rw', db.meals, async () => {
    for (const item of items) {
      const row = await create<MealLog>(db.meals, {
        date,
        slot: item.slot,
        foodId: item.foodId,
        servings: item.servings,
      });
      ids.push(row.id);
    }
  });
  return ids;
}

/** Undoes one bulk write, by the ids it returned. */
export async function deleteMeals(ids: string[]): Promise<void> {
  await db.transaction('rw', db.meals, async () => {
    for (const id of ids) await remove(db.meals, id);
  });
}

/**
 * Swaps out everything logged for a day and puts this plan there instead.
 *
 * What "log this whole day" has to mean once she has already eaten something:
 * adding a whole day on top of a breakfast is the same double-count bug in a
 * different hat. One transaction, because two are a window in which her day
 * is empty.
 */
export async function replaceDayPlan(
  items: { foodId: string; slot: MealSlot; servings: number }[],
  date = dateKey(),
): Promise<void> {
  await db.transaction('rw', db.meals, async () => {
    const existing = await db.meals.where('date').equals(date).toArray();
    for (const row of existing) {
      if (row.deletedAt === null) await remove(db.meals, row.id);
    }
    for (const item of items) {
      await create<MealLog>(db.meals, {
        date,
        slot: item.slot,
        foodId: item.foodId,
        servings: item.servings,
      });
    }
  });
}

export async function clearMealsFor(date = dateKey()): Promise<void> {
  const rows = await db.meals.where('date').equals(date).toArray();
  await Promise.all(
    rows.filter((row) => row.deletedAt === null).map((row) => remove(db.meals, row.id)),
  );
}

/* -------------------------------- coach -------------------------------- */

export async function addChatMessage(
  role: ChatRole,
  content: string,
  failed = false,
): Promise<ChatMessage> {
  return create<ChatMessage>(db.chat, {
    role,
    content,
    createdAt: Date.now(),
    failed,
  });
}

export async function deleteChatMessage(id: string): Promise<void> {
  await remove(db.chat, id);
}

/* ---------------------------- coach proposals ---------------------------- */

/**
 * Accepting the food the coach offered.
 *
 * The items come from the card she just edited, not from the model's reply -
 * the two diverge the moment she takes a roti off the plate, and what goes in
 * the log has to be what she saw when she tapped.
 *
 * Marked on the message in the same breath, so the card turns into a receipt
 * rather than an offer to do it again.
 */
export async function acceptMealProposal(
  messageId: string,
  items: { foodId: string; slot: MealSlot; servings: number }[],
  date = dateKey(),
): Promise<void> {
  if (items.length === 0) return;
  await logDayPlan(items, date);
  await markProposalApplied(messageId);
}

/** Accepting the exercise swaps the coach offered. */
export async function acceptSessionProposal(
  messageId: string,
  swaps: { slotKey: string; exerciseId: string }[],
): Promise<void> {
  if (swaps.length === 0) return;
  await swapExercises(swaps);
  await markProposalApplied(messageId);
}

/**
 * Accepting sets the coach wrote down from what she told it.
 *
 * Opens a session if none is running, because "I did three sets of ten" is
 * something she says having trained, not having first remembered to press
 * Start - and sets with nowhere to live would be silently dropped.
 *
 * `sets` is a repeat count, so three identical sets become three rows. The
 * progression engine counts rows, and one row saying "x3" would read as a
 * single set at that weight and hold her there.
 */
export async function acceptLogProposal(
  messageId: string,
  entries: {
    exerciseId: string;
    weightKg: number;
    reps: number;
    sets: number;
    rir: number | null;
  }[],
  templateId: string | null,
): Promise<void> {
  if (entries.length === 0) return;

  const session = await startSession(templateId);

  for (const entry of entries) {
    for (let index = 0; index < entry.sets; index++) {
      await logSet(session.id, entry.exerciseId, {
        weightKg: entry.weightKg,
        reps: entry.reps,
        rir: entry.rir,
      });
    }
  }

  await markProposalApplied(messageId);
}

export async function markProposalApplied(messageId: string): Promise<void> {
  await patch(db.chat, messageId, { appliedAt: Date.now() });
}

export async function addCoachNote(
  kind: CoachNoteKind,
  content: string,
  coversUntil: number | null = null,
): Promise<CoachNote> {
  return create<CoachNote>(db.coachNotes, {
    kind,
    content,
    createdAt: Date.now(),
    coversUntil,
  });
}

export async function deleteCoachNote(id: string): Promise<void> {
  await remove(db.coachNotes, id);
}

/**
 * Forgets the conversation.
 *
 * Deletes the summaries as well as the messages: a summary of a conversation
 * she asked the app to forget is still that conversation, and leaving it
 * behind would make "forget this" a lie.
 *
 * Standing notes survive. She typed those into a box labelled "things it
 * should always know", which is a different act from having said something in
 * a chat - deleting them here would quietly throw away a deliberate
 * instruction, and there is a Remove button next to each one for that.
 */
export async function clearCoachMemory(): Promise<void> {
  const [messages, notes] = await Promise.all([
    db.chat.toArray(),
    db.coachNotes.where('kind').equals('summary').toArray(),
  ]);
  await Promise.all([
    ...messages
      .filter((row) => row.deletedAt === null)
      .map((row) => remove(db.chat, row.id)),
    ...notes
      .filter((row) => row.deletedAt === null)
      .map((row) => remove(db.coachNotes, row.id)),
  ]);
}

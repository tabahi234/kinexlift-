import { db } from './db';
import { create, patch, remove, updateProfile } from './repo';
import { getOpenSession } from './queries';
import { dateKey } from '../lib/date';
import type { Checkin, Session, SetLog, SymptomTag } from './schema';

/** Every mutation the training UI performs, in one place. */

export async function startSession(templateId: string): Promise<Session> {
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
  const sets = await db.sets.where('sessionId').equals(sessionId).count();

  // An abandoned session with nothing logged should not count as training, and
  // should not advance the program rotation.
  if (sets === 0) {
    await remove(db.sessions, sessionId);
    return;
  }

  const now = Date.now();
  await db.sessions.update(sessionId, { endedAt: now, updatedAt: now });
}

/** Discards an in-progress session and everything logged into it. */
export async function abandonSession(sessionId: string): Promise<void> {
  const sets = await db.sets.where('sessionId').equals(sessionId).toArray();
  await Promise.all(sets.map((set) => remove(db.sets, set.id)));
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
  const profile = await db.profile.get('profile');
  await updateProfile({
    exerciseOverrides: { ...(profile?.exerciseOverrides ?? {}), [slotKey]: exerciseId },
  });
}

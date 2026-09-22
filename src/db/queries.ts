import Dexie from 'dexie';
import { db } from './db';
import type {
  BodyMetric,
  ChatMessage,
  Checkin,
  CoachNote,
  ConditioningLog,
  CycleEvent,
  MealLog,
  SetLog,
  Session,
} from './schema';
import type { SessionHistory, WorkingSet } from '../domain/progression';
import { detectStall, e1rm } from '../domain/progression';
import { exerciseName } from '../domain/exercises';
import type { LiftSnapshot } from '../domain/coach';
import {
  addNutrients,
  foodFor,
  NO_NUTRIENTS,
  scale,
  type Nutrients,
} from '../domain/foods';
import { conditioningKcal } from '../domain/conditioning';
import { LIFTING_MET, metKcal } from '../domain/nutrition';
import {
  bandFor,
  readinessScore,
  OVERRIDE_WINDOW,
  type OverrideTally,
} from '../domain/readiness';
import { dateKey } from '../lib/date';
import { buildChecklist, type Checklist } from '../domain/supplements';

/**
 * Read models.
 *
 * Nothing here is stored - every number the app shows is computed from set
 * rows on demand. That is what stops the dashboard from ever disagreeing with
 * the log.
 */

const live = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null);

const toWorkingSet = (set: SetLog): WorkingSet => ({
  weightKg: set.weightKg,
  reps: set.reps,
  rir: set.rir,
});

/**
 * Working sets for one exercise, grouped by session, most recent first.
 * Uses the [exerciseId+performedAt] compound index, so this stays a range scan
 * however long her history gets.
 */
export async function getExerciseHistory(
  exerciseId: string,
  maxSessions = 6,
  /**
   * The session currently underway. Its sets must not count as history: if
   * they did, logging set one would recompute the prescription from itself,
   * and the target weight could move between sets of the same exercise.
   */
  excludeSessionId?: string,
): Promise<SessionHistory> {
  const rows = await db.sets
    .where('[exerciseId+performedAt]')
    .between([exerciseId, Dexie.minKey], [exerciseId, Dexie.maxKey])
    .reverse()
    .limit(maxSessions * 12)
    .toArray();

  const bySession = new Map<string, { at: number; sets: WorkingSet[] }>();
  for (const set of live(rows)) {
    if (set.isWarmup) continue;
    if (excludeSessionId && set.sessionId === excludeSessionId) continue;
    const entry = bySession.get(set.sessionId);
    if (entry) {
      entry.sets.push(toWorkingSet(set));
      entry.at = Math.max(entry.at, set.performedAt);
    } else {
      bySession.set(set.sessionId, { at: set.performedAt, sets: [toWorkingSet(set)] });
    }
  }

  return [...bySession.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, maxSessions)
    .map((entry) => entry.sets);
}

/** The template day she finished most recently, so rotation can advance. */
export async function getLastCompletedDayId(): Promise<string | null> {
  const sessions = live(await db.sessions.orderBy('startedAt').reverse().toArray());
  const finished = sessions.find(
    (session) => session.endedAt !== null && session.templateId !== null,
  );
  return finished?.templateId ?? null;
}

/** A session started but not finished - she is mid-workout. */
export async function getOpenSession(): Promise<Session | undefined> {
  const sessions = live(await db.sessions.orderBy('startedAt').reverse().limit(5).toArray());
  return sessions.find((session) => session.endedAt === null);
}

export async function getSetsForSession(sessionId: string): Promise<SetLog[]> {
  const rows = await db.sets.where('sessionId').equals(sessionId).toArray();
  return live(rows).sort((a, b) => a.performedAt - b.performedAt);
}

export interface ProgressPoint {
  date: string;
  e1rm: number;
}

/**
 * Best estimated 1RM per training day, oldest first. Sessions whose sets were
 * all too high-rep to estimate from are skipped rather than guessed at.
 */
export async function getE1rmSeries(exerciseId: string): Promise<ProgressPoint[]> {
  const rows = await db.sets
    .where('[exerciseId+performedAt]')
    .between([exerciseId, Dexie.minKey], [exerciseId, Dexie.maxKey])
    .toArray();

  const bestByDay = new Map<string, number>();
  for (const set of live(rows)) {
    if (set.isWarmup) continue;
    const estimate = e1rm(set.weightKg, set.reps, set.rir);
    if (estimate === null) continue;
    const day = dateKey(new Date(set.performedAt));
    bestByDay.set(day, Math.max(bestByDay.get(day) ?? 0, estimate));
  }

  return [...bestByDay.entries()]
    .map(([date, value]) => ({ date, e1rm: value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Distinct exercises she has actually logged, most recently trained first. */
export async function getLoggedExerciseIds(): Promise<string[]> {
  const rows = live(await db.sets.orderBy('performedAt').reverse().toArray());
  const seen: string[] = [];
  for (const set of rows) {
    if (!seen.includes(set.exerciseId)) seen.push(set.exerciseId);
  }
  return seen;
}

export async function getCheckinFor(date = dateKey()): Promise<Checkin | undefined> {
  const found = await db.checkins.where('date').equals(date).first();
  return found && found.deletedAt === null ? found : undefined;
}

/**
 * How often a low-readiness suggestion was overridden recently.
 *
 * "Offered" is derived rather than stored: a session counts if the check-in
 * for its date scored below green. That keeps the tally correct even for
 * sessions logged before this feature existed.
 */
export async function getOverrideTally(): Promise<OverrideTally> {
  const [sessions, checkins] = await Promise.all([
    db.sessions.orderBy('startedAt').reverse().toArray(),
    db.checkins.toArray(),
  ]);

  const byDate = new Map(live(checkins).map((checkin) => [checkin.date, checkin]));
  const tally: OverrideTally = { offered: 0, overridden: 0 };

  for (const session of live(sessions)) {
    if (session.endedAt === null) continue;

    const checkin = byDate.get(dateKey(new Date(session.startedAt)));
    if (!checkin) continue;
    if (bandFor(readinessScore(checkin)) === 'green') continue;

    tally.offered++;
    if (session.readinessOverride) tally.overridden++;
    if (tally.offered >= OVERRIDE_WINDOW) break;
  }

  return tally;
}

export interface TrainingSummary {
  sessionsAllTime: number;
  sessionsThisMonth: number;
  setsAllTime: number;
  lastTrainedDate: string | null;
}

/**
 * "Sessions this month" rather than a streak: a streak punishes exactly the
 * weeks she most needs permission to rest, and breaking one is a common reason
 * people delete a fitness app for good.
 */
export async function getTrainingSummary(): Promise<TrainingSummary> {
  const sessions = live(await db.sessions.toArray()).filter((s) => s.endedAt !== null);
  const sets = live(await db.sets.toArray());

  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const dates = sessions.map((session) => dateKey(new Date(session.startedAt))).sort();

  return {
    sessionsAllTime: sessions.length,
    sessionsThisMonth: dates.filter((date) => date.startsWith(monthPrefix)).length,
    setsAllTime: sets.filter((set) => !set.isWarmup).length,
    lastTrainedDate: dates.at(-1) ?? null,
  };
}

/* ------------------------------- cycle ------------------------------- */

export async function getCycleEvents(): Promise<CycleEvent[]> {
  return live(await db.cycleEvents.toArray()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export async function getCheckins(): Promise<Checkin[]> {
  return live(await db.checkins.toArray()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Most recent first, for the readiness strip and the coach briefing. */
export async function getRecentCheckins(limit = 14): Promise<Checkin[]> {
  const rows = await getCheckins();
  return rows.slice(-limit).reverse();
}

/* ------------------------------- body ------------------------------- */

export async function getBodyMetrics(): Promise<BodyMetric[]> {
  return live(await db.bodyMetrics.toArray()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export async function getLatestBodyMetric(): Promise<BodyMetric | null> {
  const rows = await getBodyMetrics();
  return rows.at(-1) ?? null;
}

/* ---------------------------- conditioning ---------------------------- */

export async function getConditioningLogs(limit = 60): Promise<ConditioningLog[]> {
  const rows = live(await db.conditioning.toArray());
  return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

/** Most recent first, filtered to one kind, for the progression engine. */
export async function getConditioningHistory(
  kind: 'easy' | 'intervals',
  limit = 8,
): Promise<ConditioningLog[]> {
  const rows = await getConditioningLogs(120);
  return rows.filter((row) => row.kind === kind).slice(0, limit);
}

export async function getConditioningForSession(
  sessionId: string,
): Promise<ConditioningLog[]> {
  const rows = live(await db.conditioning.toArray());
  return rows.filter((row) => row.sessionId === sessionId);
}

/* ------------------------------ nutrition ------------------------------ */

export async function getMealsFor(date = dateKey()): Promise<MealLog[]> {
  const rows = await db.meals.where('date').equals(date).toArray();
  return live(rows);
}

/**
 * What a day's logged food adds up to.
 *
 * A meal whose food id is not in the table is skipped rather than counted as
 * zero, so a stale row from an older table version cannot silently deflate
 * the day's total.
 */
export function totalsForMeals(meals: MealLog[]): Nutrients {
  return meals.reduce((sum, meal) => {
    const food = foodFor(meal);
    return food ? addNutrients(sum, scale(food, meal.servings)) : sum;
  }, NO_NUTRIENTS);
}

export async function getIntakeFor(date = dateKey()): Promise<Nutrients> {
  return totalsForMeals(await getMealsFor(date));
}

export interface IntakeHistoryPoint {
  date: string;
  totals: Nutrients;
}

/** Days on which she logged any food at all, most recent last. */
export async function getIntakeHistory(days = 14): Promise<IntakeHistoryPoint[]> {
  const rows = live(await db.meals.toArray());
  const byDate = new Map<string, MealLog[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.date);
    if (bucket) bucket.push(row);
    else byDate.set(row.date, [row]);
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-days)
    .map(([date, meals]) => ({ date, totals: totalsForMeals(meals) }));
}

/* -------------------------------- coach -------------------------------- */

export async function getChatMessages(limit = 200): Promise<ChatMessage[]> {
  const rows = live(await db.chat.toArray());
  return rows.sort((a, b) => a.createdAt - b.createdAt).slice(-limit);
}

/**
 * One reply, live.
 *
 * The ask boxes on Today and Fuel show the last answer and the card attached
 * to it. They need that one row to stay current - whether its proposal has
 * been accepted decides what the card says - without subscribing to the whole
 * conversation from two screens that are not the conversation.
 */
export async function getChatMessage(id: string): Promise<ChatMessage | null> {
  const row = await db.chat.get(id);
  return row && row.deletedAt === null ? row : null;
}

export async function getCoachNotes(): Promise<CoachNote[]> {
  return live(await db.coachNotes.toArray()).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Per-lift progress, computed the same way the charts are.
 *
 * The coach reads this rather than the raw log: a language model handed six
 * months of set rows will produce a confident number that is not in them.
 */
export async function getLiftSnapshots(limit = 8): Promise<LiftSnapshot[]> {
  const exerciseIds = (await getLoggedExerciseIds()).slice(0, limit);
  const snapshots: LiftSnapshot[] = [];

  for (const exerciseId of exerciseIds) {
    const history = await getExerciseHistory(exerciseId, 12);
    if (history.length === 0) continue;

    const series = await getE1rmSeries(exerciseId);
    const first = series[0]?.e1rm ?? null;
    const last = series.at(-1)?.e1rm ?? null;
    const changeKg =
      first === null || last === null || series.length < 2
        ? null
        : Math.round((last - first) * 10) / 10;

    const latest = history[0]!;
    const lastWeightKg = latest.reduce((max, set) => Math.max(max, set.weightKg), 0);

    snapshots.push({
      exerciseId,
      name: exerciseName(exerciseId),
      sessions: history.length,
      lastPerformed: series.at(-1)?.date ?? null,
      lastWeightKg: Math.round(lastWeightKg * 10) / 10,
      bestE1rm: series.length ? Math.round(Math.max(...series.map((p) => p.e1rm))) : null,
      changeKg,
      trend:
        history.length < 2
          ? 'new'
          : changeKg === null
            ? 'flat'
            : changeKg > 0.5
              ? 'up'
              : changeKg < -0.5
                ? 'down'
                : 'flat',
      stalled: detectStall(history),
    });
  }

  return snapshots;
}

/**
 * Kilocalories spent training per week, from the log rather than the plan.
 *
 * Averaged over four weeks so a missed week lowers the estimate gradually
 * instead of dropping her calorie target off a cliff the moment she takes a
 * holiday.
 */
export async function getTrainingKcalPerWeek(weightKg: number): Promise<number> {
  if (!(weightKg > 0)) return 0;

  const since = Date.now() - 28 * 86_400_000;
  const sessions = live(await db.sessions.toArray()).filter(
    (session) => session.endedAt !== null && session.startedAt >= since,
  );

  let total = 0;
  for (const session of sessions) {
    const minutes = Math.min(
      120,
      Math.max(20, Math.round(((session.endedAt ?? 0) - session.startedAt) / 60_000)),
    );
    total += metKcal(LIFTING_MET, minutes, weightKg);
  }

  const conditioning = live(await db.conditioning.toArray()).filter(
    (log) => Date.parse(`${log.date}T12:00:00Z`) >= since,
  );
  for (const log of conditioning) total += conditioningKcal(log, weightKg);

  return Math.round(total / 4);
}

export async function getSessionsSince(days: number): Promise<number> {
  const since = Date.now() - days * 86_400_000;
  return live(await db.sessions.toArray()).filter(
    (session) => session.endedAt !== null && session.startedAt >= since,
  ).length;
}

/* ----------------------------- supplements ----------------------------- */

/** Everything the supplements card needs for one day, in one read. */
export async function getSupplementChecklist(date = dateKey()): Promise<Checklist> {
  const [supplements, intake] = await Promise.all([
    db.supplements.toArray(),
    db.supplementIntake.where('date').equals(date).toArray(),
  ]);
  return buildChecklist(supplements, intake, date);
}

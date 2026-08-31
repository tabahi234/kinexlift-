import Dexie from 'dexie';
import { db } from './db';
import type { Checkin, SetLog, Session } from './schema';
import type { SessionHistory, WorkingSet } from '../domain/progression';
import { e1rm } from '../domain/progression';
import {
  bandFor,
  readinessScore,
  OVERRIDE_WINDOW,
  type OverrideTally,
} from '../domain/readiness';
import { dateKey } from '../lib/date';

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

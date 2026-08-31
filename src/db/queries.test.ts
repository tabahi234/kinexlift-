import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { create } from './repo';
import { wipeAll } from './export';
import {
  clearTodaysCheckin,
  finishSession,
  logSet,
  saveCheckin,
  setReadinessOverride,
  startSession,
} from './actions';
import {
  getCheckinFor,
  getExerciseHistory,
  getLastCompletedDayId,
  getOverrideTally,
  getTrainingSummary,
} from './queries';
import { shouldOfferToStopAdjusting } from '../domain/readiness';
import type { SetLog } from './schema';

beforeEach(async () => {
  await wipeAll();
});

describe('exercise history', () => {
  it('excludes the session currently underway', async () => {
    const past = await startSession('fb-a');
    await logSet(past.id, 'goblet-squat', { weightKg: 10, reps: 8, rir: 2 });
    await finishSession(past.id);

    const current = await startSession('fb-a');
    await logSet(current.id, 'goblet-squat', { weightKg: 10, reps: 9, rir: 1 });

    // Without the exclusion, logging a set mid-workout would feed straight back
    // into the prescription and could move the target weight between sets.
    const history = await getExerciseHistory('goblet-squat', 6, current.id);
    expect(history).toHaveLength(1);
    expect(history[0]![0]!.reps).toBe(8);

    const everything = await getExerciseHistory('goblet-squat');
    expect(everything).toHaveLength(2);
  });

  it('groups sets by session, newest first', async () => {
    const older = await startSession('fb-a');
    await logSet(older.id, 'goblet-squat', { weightKg: 10, reps: 8, rir: 2 });
    await logSet(older.id, 'goblet-squat', { weightKg: 10, reps: 8, rir: 2 });
    await finishSession(older.id);

    const newer = await startSession('fb-a');
    await logSet(newer.id, 'goblet-squat', { weightKg: 12, reps: 6, rir: 1 });
    await finishSession(newer.id);

    const history = await getExerciseHistory('goblet-squat');
    expect(history).toHaveLength(2);
    expect(history[0]).toHaveLength(1);
    expect(history[0]![0]!.weightKg).toBe(12);
    expect(history[1]).toHaveLength(2);
  });

  it('ignores warm-up sets', async () => {
    const session = await startSession('fb-a');
    await create<SetLog>(db.sets, {
      sessionId: session.id,
      exerciseId: 'goblet-squat',
      performedAt: Date.now(),
      weightKg: 4,
      reps: 10,
      rir: 5,
      isWarmup: true,
    });
    await finishSession(session.id);

    expect(await getExerciseHistory('goblet-squat')).toHaveLength(0);
  });
});

describe('finishing a session', () => {
  it('discards an empty session instead of counting it as training', async () => {
    const session = await startSession('fb-a');
    await finishSession(session.id);

    // An abandoned session must not advance the rotation or inflate her totals.
    expect(await getLastCompletedDayId()).toBeNull();
    expect((await getTrainingSummary()).sessionsAllTime).toBe(0);
  });

  it('records a session that has sets in it', async () => {
    const session = await startSession('fb-a');
    await logSet(session.id, 'goblet-squat', { weightKg: 10, reps: 8, rir: 2 });
    await finishSession(session.id);

    expect(await getLastCompletedDayId()).toBe('fb-a');

    const summary = await getTrainingSummary();
    expect(summary.sessionsAllTime).toBe(1);
    expect(summary.sessionsThisMonth).toBe(1);
    expect(summary.setsAllTime).toBe(1);
  });

  it('does not start a second session while one is open', async () => {
    const first = await startSession('fb-a');
    const second = await startSession('fb-b');
    expect(second.id).toBe(first.id);
  });
});

describe('check-ins', () => {
  it('updates today rather than inserting a second row', async () => {
    // The date index is unique, so a second insert would throw outright.
    const first = await saveCheckin({ sleep: 2, energy: 2, soreness: 4, symptoms: [] });
    const second = await saveCheckin({
      sleep: 5,
      energy: 4,
      soreness: 1,
      symptoms: ['cramps'],
    });

    expect(second.id).toBe(first.id);
    expect(await db.checkins.count()).toBe(1);

    const stored = await getCheckinFor();
    expect(stored?.energy).toBe(4);
    expect(stored?.symptoms).toEqual(['cramps']);
  });

  it('hides a deleted check-in', async () => {
    await saveCheckin({ sleep: 3, energy: 3, soreness: 3, symptoms: [] });
    await clearTodaysCheckin();
    expect(await getCheckinFor()).toBeUndefined();
  });
});

describe('override tally', () => {
  /** A finished session on a given date, with a check-in to match. */
  async function trainedOn(
    date: string,
    checkin: { sleep: number; energy: number; soreness: number },
    overrode: boolean,
  ) {
    await saveCheckin({ ...checkin, symptoms: [] }, date);

    const session = await startSession('fb-a');
    await db.sessions.update(session.id, {
      startedAt: Date.parse(`${date}T12:00:00`),
    });
    await logSet(session.id, 'goblet-squat', { weightKg: 10, reps: 8, rir: 2 });
    if (overrode) await setReadinessOverride(session.id, true);
    await finishSession(session.id);
  }

  const rough = { sleep: 1, energy: 2, soreness: 5 };
  const fine = { sleep: 5, energy: 5, soreness: 1 };

  it('counts only the days she was actually offered a lighter session', async () => {
    await trainedOn('2026-08-03', fine, false);
    await trainedOn('2026-08-05', rough, true);
    await trainedOn('2026-08-07', rough, false);

    const tally = await getOverrideTally();
    expect(tally.offered).toBe(2); // the green day does not count
    expect(tally.overridden).toBe(1);
  });

  it('reaches the threshold once she has overridden most of a run', async () => {
    await trainedOn('2026-08-01', rough, true);
    await trainedOn('2026-08-03', rough, true);
    await trainedOn('2026-08-05', rough, false);
    await trainedOn('2026-08-07', rough, true);

    const tally = await getOverrideTally();
    expect(tally.offered).toBe(4);
    expect(tally.overridden).toBe(3);
    expect(shouldOfferToStopAdjusting(tally)).toBe(true);
  });

  it('ignores sessions with no check-in to judge them by', async () => {
    const session = await startSession('fb-a');
    await logSet(session.id, 'goblet-squat', { weightKg: 10, reps: 8, rir: 2 });
    await finishSession(session.id);

    expect(await getOverrideTally()).toEqual({ offered: 0, overridden: 0 });
  });
});

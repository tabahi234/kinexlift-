import { describe, expect, it } from 'vitest';
import type { SetLog } from '../db/schema';
import {
  DEFAULT_DAYS,
  describeNextTrainingDay,
  describeOpensAt,
  gapNote,
  isTrainingDay,
  nextTrainingDate,
  normaliseDays,
  praiseFor,
  SESSION_COOLDOWN_MS,
  sessionGate,
  summariseSession,
  trainingDaysOf,
} from './schedule';

// 2026-09-22 is a Tuesday.
const tuesday = new Date(2026, 8, 22, 18, 0, 0).getTime();
const HOUR = 3_600_000;

describe('training days', () => {
  it('reads absent as "any day" rather than inventing a schedule', () => {
    expect(trainingDaysOf({})).toBeNull();
    expect(trainingDaysOf({ trainingDays: [] })).toBeNull();
    expect(isTrainingDay(null, new Date(tuesday))).toBe(true);
  });

  it('normalises to Monday-first, unique, real weekdays', () => {
    expect(normaliseDays([5, 1, 1, 0, 9, -1, 3.5])).toEqual([1, 5, 0]);
  });

  it('every default has as many days as its key', () => {
    for (const [count, days] of Object.entries(DEFAULT_DAYS)) {
      expect(days).toHaveLength(Number(count));
    }
  });

  it('finds the next training day after today, wrapping the week', () => {
    const monWedFri = [1, 3, 5];
    expect(nextTrainingDate(monWedFri, new Date(tuesday))!.getDay()).toBe(3);
    expect(describeNextTrainingDay(monWedFri, new Date(tuesday))).toBe('tomorrow');
    // From a Friday, the next one is Monday.
    const friday = new Date(2026, 8, 25);
    expect(describeNextTrainingDay(monWedFri, friday)).toBe('on Monday');
    // One day a week: the same day next week.
    expect(describeNextTrainingDay([2], new Date(tuesday))).toBe('next Tuesday');
    expect(nextTrainingDate([], new Date(tuesday))).toBeNull();
  });
});

describe('sessionGate', () => {
  it('is open on a training day with nothing recent', () => {
    expect(sessionGate({ now: tuesday, lastFinishedAt: null, trainingDays: [2], overridden: false }))
      .toEqual({ kind: 'open' });
  });

  it('holds for eight hours after a finished session, then opens', () => {
    const finished = tuesday - 2 * HOUR;
    const gate = sessionGate({ now: tuesday, lastFinishedAt: finished, trainingDays: null, overridden: false });
    expect(gate.kind).toBe('cooldown');
    if (gate.kind === 'cooldown') expect(gate.opensAt).toBe(finished + SESSION_COOLDOWN_MS);

    const later = sessionGate({ now: finished + SESSION_COOLDOWN_MS, lastFinishedAt: finished, trainingDays: null, overridden: false });
    expect(later).toEqual({ kind: 'open' });
  });

  it('cooldown outranks the calendar, and the override outranks both', () => {
    const finished = tuesday - HOUR;
    // Tuesday is not a training day here either.
    expect(sessionGate({ now: tuesday, lastFinishedAt: finished, trainingDays: [1, 3], overridden: false }).kind).toBe('cooldown');
    expect(sessionGate({ now: tuesday, lastFinishedAt: finished, trainingDays: [1, 3], overridden: true })).toEqual({ kind: 'open' });
  });

  it('names the next training day on a rest day', () => {
    const gate = sessionGate({ now: tuesday, lastFinishedAt: null, trainingDays: [1, 4], overridden: false });
    expect(gate).toEqual({ kind: 'rest-day', next: 'on Thursday' });
  });

  it('describes the wait in hours and minutes', () => {
    expect(describeOpensAt(tuesday + 2 * HOUR + 15 * 60_000, tuesday)).toBe('opens in 2 h 15 min');
    expect(describeOpensAt(tuesday + 5 * 60_000, tuesday)).toBe('opens in 5 min');
    expect(describeOpensAt(tuesday - 1, tuesday)).toBe('opens in a minute');
  });
});

describe('gapNote', () => {
  it('says nothing under three days, and never counts missed sessions', () => {
    expect(gapNote(null)).toBeNull();
    expect(gapNote(2)).toBeNull();
    expect(gapNote(4)).toContain('4 days');
    expect(gapNote(30)).toMatch(/Welcome back/);
    for (const days of [3, 10, 40]) expect(gapNote(days)).not.toMatch(/missed|streak/i);
  });
});

describe('summariseSession', () => {
  const set = (exerciseId: string, weightKg: number, reps: number, over: Partial<SetLog> = {}): SetLog => ({
    id: `${exerciseId}-${weightKg}-${reps}`,
    updatedAt: 1,
    deletedAt: null,
    schemaVersion: 3,
    sessionId: 's',
    exerciseId,
    performedAt: 1,
    weightKg,
    reps,
    rir: 2,
    isWarmup: false,
    ...over,
  });

  it('counts working sets, reps and volume, and skips warm-ups and deleted rows', () => {
    const summary = summariseSession(
      [
        set('goblet-squat', 10, 8),
        set('goblet-squat', 10, 8, { id: 'w', isWarmup: true }),
        set('push-up', 0, 12),
        set('push-up', 0, 12, { id: 'd', deletedAt: 5 }),
      ],
      new Map(),
    );
    expect(summary.sets).toBe(2);
    expect(summary.reps).toBe(20);
    expect(summary.volumeKg).toBe(80);
    expect(summary.exercises).toBe(2);
  });

  it('claims a best only against real history', () => {
    const sets = [set('goblet-squat', 12, 10)];
    expect(summariseSession(sets, new Map()).bests).toEqual([]);
    expect(summariseSession(sets, new Map([['goblet-squat', 12]])).bests).toEqual(['Goblet squat']);
    expect(summariseSession(sets, new Map([['goblet-squat', 40]])).bests).toEqual([]);
  });

  it('praises without a streak', () => {
    const summary = summariseSession([set('goblet-squat', 12, 10)], new Map([['goblet-squat', 12]]));
    expect(praiseFor(summary, false)).toContain('new best');
    expect(praiseFor(summariseSession([], new Map()), true)).toContain('Conditioning');
  });
});

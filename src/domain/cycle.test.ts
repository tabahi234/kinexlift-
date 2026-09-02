import { describe, expect, it } from 'vitest';
import {
  cycleStats,
  cycleStatus,
  phaseForDay,
  phaseWindows,
  periodStarts,
  LUTEAL_DAYS,
} from './cycle';
import type { CycleEvent, CycleEventKind } from '../db/schema';

let counter = 0;
const event = (date: string, kind: CycleEventKind = 'period_start'): CycleEvent => ({
  id: `event-${counter++}`,
  updatedAt: 0,
  deletedAt: null,
  schemaVersion: 2,
  date,
  kind,
});

describe('reading the log', () => {
  it('collapses a period entered twice', () => {
    // Two starts three days apart is one period logged badly, and treating it
    // as a three-day cycle would wreck every statistic downstream.
    const starts = periodStarts([event('2026-01-01'), event('2026-01-04')]);
    expect(starts).toEqual(['2026-01-01']);
  });

  it('ignores deleted events', () => {
    const deleted = { ...event('2026-02-01'), deletedAt: 1 };
    expect(periodStarts([event('2026-01-01'), deleted])).toEqual(['2026-01-01']);
  });

  it('excludes an implausible gap from the length statistics', () => {
    // Four months without an entry is missed logging, not a 120-day cycle.
    const stats = cycleStats([
      event('2026-01-01'),
      event('2026-01-29'),
      event('2026-05-29'),
    ]);
    expect(stats.lengths).toEqual([28]);
    expect(stats.completeCycles).toBe(1);
  });

  it('takes cycle length from her own data, not from 28', () => {
    const stats = cycleStats([
      event('2026-01-01'),
      event('2026-02-03'),
      event('2026-03-08'),
      event('2026-04-10'),
    ]);
    expect(stats.medianLengthDays).toBe(33);
  });

  it('does not claim confidence from a single cycle', () => {
    expect(cycleStats([event('2026-01-01'), event('2026-01-29')]).confidence).toBe('low');
    expect(cycleStats([]).confidence).toBe('none');
  });

  it('rates six steady cycles as high confidence', () => {
    const dates = [
      '2026-01-01',
      '2026-01-29',
      '2026-02-26',
      '2026-03-26',
      '2026-04-23',
      '2026-05-21',
      '2026-06-18',
    ];
    expect(cycleStats(dates.map((date) => event(date))).confidence).toBe('high');
  });
});

describe('phases', () => {
  it('places ovulation by counting back from the next period', () => {
    // The common mistake is fixing ovulation at day 14 regardless of cycle
    // length, which is wrong by a week for anyone on a 35-day cycle.
    const long = phaseWindows(35, 5).find((window) => window.phase === 'ovulatory')!;
    const short = phaseWindows(25, 5).find((window) => window.phase === 'ovulatory')!;
    expect(long.toDay - 1).toBe(35 - LUTEAL_DAYS);
    expect(short.toDay - 1).toBe(25 - LUTEAL_DAYS);
  });

  it('covers every day of the cycle with exactly one phase', () => {
    for (const length of [21, 28, 31, 35]) {
      for (let day = 1; day <= length; day++) {
        expect(phaseForDay(day, length, 5)).not.toBeNull();
      }
    }
  });

  it('keeps a late day luteal rather than wrapping to day one', () => {
    expect(phaseForDay(32, 28, 5)).toBe('luteal');
  });

  it('starts with the bleed and never overlaps it with ovulation', () => {
    const windows = phaseWindows(28, 6);
    expect(windows[0]!.phase).toBe('menstrual');
    expect(windows[0]!.toDay).toBe(6);
    const ovulatory = windows.find((window) => window.phase === 'ovulatory')!;
    expect(ovulatory.fromDay).toBeGreaterThan(6);
  });
});

describe('status', () => {
  const regular = [
    event('2026-01-01'),
    event('2026-01-29'),
    event('2026-02-26'),
    event('2026-03-26'),
  ];

  it('counts the cycle day from the last start', () => {
    const status = cycleStatus(regular, '2026-04-05');
    expect(status.dayOfCycle).toBe(11);
    expect(status.phase).toBe('follicular');
  });

  it('predicts the next period with a window around it', () => {
    const status = cycleStatus(regular, '2026-04-05');
    expect(status.predictedNextStart).toBe('2026-04-23');
    expect(status.predictedWindow).not.toBeNull();
    expect(status.daysUntilNext).toBe(18);
  });

  it('says nothing at all with no data', () => {
    const status = cycleStatus([], '2026-04-05');
    expect(status.phase).toBeNull();
    expect(status.predictedNextStart).toBeNull();
    expect(status.flags).toEqual(['no-data']);
  });

  it('gives a day count from one period but refuses to predict', () => {
    const status = cycleStatus([event('2026-04-01')], '2026-04-05');
    expect(status.dayOfCycle).toBe(5);
    expect(status.predictedNextStart).toBeNull();
  });

  it('flags a period that has stopped', () => {
    const status = cycleStatus(regular, '2026-08-01');
    expect(status.flags).toContain('absent');
  });

  it('does not also call an absent period late', () => {
    // Both flags at once would put a mild "you are a bit late" note next to
    // the one message on this screen that actually matters.
    const status = cycleStatus(regular, '2026-08-01');
    expect(status.flags).not.toContain('late');
  });

  it('does not call two textbook cycles irregular', () => {
    // Two identical 28-day cycles are always "low confidence" - two of
    // anything is - and keying the irregularity flag off confidence told
    // exactly the wrong person that her cycles vary a lot.
    const steady = [event('2026-01-01'), event('2026-01-29'), event('2026-02-26')];
    expect(cycleStatus(steady, '2026-03-01').flags).not.toContain('irregular');
  });

  it('flags cycles too irregular to predict from', () => {
    const erratic = [
      event('2026-01-01'),
      event('2026-01-19'),
      event('2026-03-05'),
      event('2026-03-25'),
    ];
    expect(cycleStatus(erratic, '2026-03-30').flags).toContain('irregular');
  });

  it('refuses a negative cycle day when a start is logged in the future', () => {
    const status = cycleStatus([event('2026-05-01')], '2026-04-05');
    expect(status.dayOfCycle).toBeNull();
  });
});

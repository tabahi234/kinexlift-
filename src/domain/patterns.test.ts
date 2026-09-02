import { describe, expect, it } from 'vitest';
import { detectPatterns, phaseOnDate } from './patterns';
import { addDays } from '../lib/date';
import type { Checkin, CycleEvent, SymptomTag } from '../db/schema';

let counter = 0;

const start = (date: string): CycleEvent => ({
  id: `event-${counter++}`,
  updatedAt: 0,
  deletedAt: null,
  schemaVersion: 2,
  date,
  kind: 'period_start',
});

const checkin = (
  date: string,
  values: { sleep: number; energy: number; soreness: number },
  symptoms: SymptomTag[] = [],
): Checkin => ({
  id: `checkin-${counter++}`,
  updatedAt: 0,
  deletedAt: null,
  schemaVersion: 2,
  date,
  ...values,
  symptoms,
});

const GOOD = { sleep: 4, energy: 4, soreness: 2 };
const ROUGH = { sleep: 2, energy: 2, soreness: 4 };

/** Four regular 28-day cycles starting on the first of January. */
const CYCLES = ['2026-01-01', '2026-01-29', '2026-02-26', '2026-03-26', '2026-04-23'];
const events = CYCLES.map(start);

/** A check-in on the given day of each cycle. */
function onDayOfEachCycle(
  day: number,
  values: { sleep: number; energy: number; soreness: number },
  symptoms: SymptomTag[] = [],
): Checkin[] {
  return CYCLES.slice(0, 4).map((cycleStart) =>
    checkin(addDays(cycleStart, day - 1), values, symptoms),
  );
}

describe('assigning a day to a phase', () => {
  it('uses the observed length of that cycle, not the median', () => {
    // The cycle beginning 1 January ran 40 days here. Using her 28-day median
    // would put 20 January in the luteal phase; the real answer is follicular.
    const starts = ['2026-01-01', '2026-02-10', '2026-03-10'];
    expect(phaseOnDate('2026-01-20', starts, 28, 5)).toBe('follicular');
  });

  it('returns null for a date before anything was logged', () => {
    expect(phaseOnDate('2025-12-01', ['2026-01-01'], 28, 5)).toBeNull();
  });
});

describe('waiting for enough data', () => {
  it('says nothing at all with no cycles logged', () => {
    const report = detectPatterns({ checkins: [], cycleEvents: [] });
    expect(report.ready).toBe(false);
    expect(report.findings).toEqual([]);
    expect(report.waitingFor).not.toBeNull();
  });

  it('refuses to report from two cycles', () => {
    const report = detectPatterns({
      checkins: onDayOfEachCycle(3, ROUGH),
      cycleEvents: [start('2026-01-01'), start('2026-01-29'), start('2026-02-26')],
    });
    expect(report.ready).toBe(false);
  });

  it('refuses when one phase has only a couple of check-ins', () => {
    const report = detectPatterns({
      checkins: [checkin('2026-01-02', ROUGH), checkin('2026-01-30', ROUGH)],
      cycleEvents: events,
    });
    expect(report.ready).toBe(false);
  });
});

describe('finding her pattern', () => {
  it('reports a phase she consistently rates lower', () => {
    const report = detectPatterns({
      checkins: [
        ...onDayOfEachCycle(2, ROUGH),
        ...onDayOfEachCycle(10, GOOD),
        ...onDayOfEachCycle(12, GOOD),
      ],
      cycleEvents: events,
    });

    expect(report.ready).toBe(true);
    const finding = report.findings.find((entry) => entry.kind === 'readiness-lower');
    expect(finding?.phase).toBe('menstrual');
  });

  it('says nothing stands out when nothing does', () => {
    const report = detectPatterns({
      checkins: [
        ...onDayOfEachCycle(2, GOOD),
        ...onDayOfEachCycle(10, GOOD),
        ...onDayOfEachCycle(12, GOOD),
      ],
      cycleEvents: events,
    });

    expect(report.ready).toBe(true);
    expect(report.nothingStandsOut).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('names a symptom that clusters in one phase', () => {
    const report = detectPatterns({
      checkins: [
        ...onDayOfEachCycle(2, GOOD, ['cramps']),
        ...onDayOfEachCycle(10, GOOD),
        ...onDayOfEachCycle(12, GOOD),
      ],
      cycleEvents: events,
    });

    const symptom = report.findings.find((entry) => entry.kind === 'symptom');
    expect(symptom?.phase).toBe('menstrual');
    expect(symptom?.text).toContain('cramps');
  });

  it('ignores a symptom she logs everywhere', () => {
    // Common in every phase is not a cycle pattern, it is just her week.
    const report = detectPatterns({
      checkins: [
        ...onDayOfEachCycle(2, GOOD, ['high_stress']),
        ...onDayOfEachCycle(10, GOOD, ['high_stress']),
        ...onDayOfEachCycle(12, GOOD, ['high_stress']),
      ],
      cycleEvents: events,
    });

    expect(report.findings.filter((entry) => entry.kind === 'symptom')).toEqual([]);
  });
});

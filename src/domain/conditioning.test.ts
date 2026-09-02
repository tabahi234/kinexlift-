import { describe, expect, it } from 'vitest';
import {
  applyReadinessToConditioning,
  conditioningKcal,
  prescribeConditioning,
  weeklyLoad,
} from './conditioning';
import { assessReadiness } from './readiness';
import { daysBetween } from '../lib/date';
import type { ConditioningLog } from '../db/schema';

let counter = 0;

const log = (over: Partial<ConditioningLog> = {}): ConditioningLog => ({
  id: `cond-${counter++}`,
  updatedAt: 0,
  deletedAt: null,
  schemaVersion: 2,
  sessionId: null,
  date: '2026-05-01',
  modality: 'incline-walk',
  kind: 'easy',
  minutes: 30,
  rpe: 4,
  distanceKm: null,
  rounds: null,
  workSeconds: null,
  restSeconds: null,
  ...over,
});

describe('easy sessions', () => {
  it('starts where her experience puts her', () => {
    expect(prescribeConditioning('easy', [], 'never').minutes).toBe(20);
    expect(prescribeConditioning('easy', [], 'experienced').minutes).toBe(30);
  });

  it('adds no more than a tenth per session', () => {
    const next = prescribeConditioning('easy', [log({ minutes: 30, rpe: 4 })], 'some');
    expect(next.minutes).toBe(33);
  });

  it('holds rather than lengthens when the easy day was not easy', () => {
    const next = prescribeConditioning('easy', [log({ minutes: 30, rpe: 9 })], 'some');
    expect(next.minutes).toBe(30);
    expect(next.rationale).toContain('slower');
  });

  it('stops growing at an hour', () => {
    const next = prescribeConditioning('easy', [log({ minutes: 60, rpe: 3 })], 'some');
    expect(next.minutes).toBe(60);
  });
});

describe('intervals', () => {
  it('starts at four rounds of one minute', () => {
    const first = prescribeConditioning('intervals', [], 'some');
    expect(first.rounds).toBe(4);
    expect(first.workSeconds).toBe(60);
  });

  it('adds a round before it lengthens the effort', () => {
    const next = prescribeConditioning(
      'intervals',
      [log({ kind: 'intervals', rounds: 5, workSeconds: 60, restSeconds: 90, rpe: 8 })],
      'some',
    );
    expect(next.rounds).toBe(6);
    expect(next.workSeconds).toBe(60);
  });

  it('lengthens the effort once the rounds top out', () => {
    const next = prescribeConditioning(
      'intervals',
      [log({ kind: 'intervals', rounds: 8, workSeconds: 60, restSeconds: 90, rpe: 8 })],
      'some',
    );
    expect(next.workSeconds).toBe(75);
    expect(next.rounds).toBeLessThan(8);
  });

  it('repeats rather than progresses after a maximal effort', () => {
    const next = prescribeConditioning(
      'intervals',
      [log({ kind: 'intervals', rounds: 6, workSeconds: 60, restSeconds: 90, rpe: 10 })],
      'some',
    );
    expect(next.rounds).toBe(6);
  });
});

describe('readiness', () => {
  it('leaves a good day alone', () => {
    const plan = prescribeConditioning('easy', [], 'some');
    const green = assessReadiness({ sleep: 4, energy: 4, soreness: 2 });
    expect(applyReadinessToConditioning(plan, green)).toBe(plan);
  });

  it('turns intervals into an easy session on a bad day', () => {
    const plan = prescribeConditioning('intervals', [], 'some');
    const red = assessReadiness({ sleep: 1, energy: 1, soreness: 5 });
    const adjusted = applyReadinessToConditioning(plan, red);
    expect(adjusted.kind).toBe('easy');
    expect(adjusted.rounds).toBeNull();
    expect(adjusted.readiness?.originalMinutes).toBe(plan.minutes);
  });

  it('changes nothing when adjustments are switched off', () => {
    const plan = prescribeConditioning('intervals', [], 'some');
    const red = assessReadiness({ sleep: 1, energy: 1, soreness: 5 });
    expect(applyReadinessToConditioning(plan, red, false)).toBe(plan);
  });
});

describe('weekly load', () => {
  it('flags a jump big enough to hurt her', () => {
    const logs = [
      log({ date: '2026-05-20', minutes: 60 }),
      log({ date: '2026-05-22', minutes: 60 }),
      log({ date: '2026-05-12', minutes: 40 }),
    ];
    const load = weeklyLoad(logs, daysBetween, '2026-05-23');
    expect(load.thisWeek).toBe(120);
    expect(load.lastWeek).toBe(40);
    expect(load.jumpTooBig).toBe(true);
  });

  it('does not flag a first week, which has nothing to jump from', () => {
    const load = weeklyLoad([log({ date: '2026-05-20', minutes: 60 })], daysBetween, '2026-05-23');
    expect(load.jumpTooBig).toBe(false);
  });
});

describe('energy cost', () => {
  it('charges more per minute for intervals than for steady work', () => {
    const steady = conditioningKcal({ modality: 'bike', minutes: 30, kind: 'easy' }, 65);
    const hard = conditioningKcal({ modality: 'bike', minutes: 30, kind: 'intervals' }, 65);
    expect(hard).toBeGreaterThan(steady);
  });
});

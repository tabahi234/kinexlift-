import { describe, expect, it } from 'vitest';
import { nextSteps, summariseSteps, type NextUpInput } from './nextUp';

const base: NextUpInput = {
  sessionName: 'Lower body A',
  conditioning: false,
  checkedIn: false,
  sessionOpen: false,
  loggedInSession: 0,
  trainedToday: false,
  nutritionReady: true,
  mealsLoggedToday: 0,
  proteinG: 0,
  proteinTargetG: 120,
  daysSinceWeighIn: 1,
  tracksCycle: false,
  daysSincePeriodLog: null,
};

const make = (overrides: Partial<NextUpInput> = {}) =>
  summariseSteps(nextSteps({ ...base, ...overrides }));

const ids = (input: Partial<NextUpInput> = {}) => make(input).steps.map((s) => s.id);

describe('nextSteps', () => {
  it('leads with the check-in, then the session', () => {
    expect(make().next?.id).toBe('checkin');
    expect(make({ checkedIn: true }).next?.id).toBe('session');
  });

  it('names the session she is actually being sent to', () => {
    const step = make({ checkedIn: true }).next!;
    expect(step.title).toBe('Start Lower body A');
    expect(step.screen).toBe('today');
  });

  it('switches from starting to finishing once a session is open', () => {
    const step = make({ checkedIn: true, sessionOpen: true, loggedInSession: 4 }).next!;
    expect(step.title).toBe('Finish Lower body A');
    expect(step.hint).toContain('4 logged');
  });

  it('moves on to food once she has trained', () => {
    expect(make({ checkedIn: true, trainedToday: true }).next?.id).toBe('food');
  });

  it('asks for the three numbers before anything about food', () => {
    const steps = ids({ nutritionReady: false });
    expect(steps[0]).toBe('fuel-setup');
    expect(steps).not.toContain('food');
    expect(steps).not.toContain('protein');
  });

  it('stays quiet about protein until something is logged', () => {
    expect(ids()).not.toContain('protein');
    expect(ids({ mealsLoggedToday: 2 })).toContain('protein');
  });

  it('counts protein as done at 80% of target, not at 100%', () => {
    const under = make({ mealsLoggedToday: 2, proteinG: 90 });
    const over = make({ mealsLoggedToday: 2, proteinG: 96 });
    expect(under.steps.find((s) => s.id === 'protein')?.done).toBe(false);
    expect(under.steps.find((s) => s.id === 'protein')?.title).toBe('30 g of protein to go');
    expect(over.steps.find((s) => s.id === 'protein')?.done).toBe(true);
  });

  it('treats a weigh-in as weekly rather than daily', () => {
    expect(make({ daysSinceWeighIn: 6 }).steps.find((s) => s.id === 'weigh-in')?.done).toBe(
      true,
    );
    expect(make({ daysSinceWeighIn: 7 }).steps.find((s) => s.id === 'weigh-in')?.done).toBe(
      false,
    );
    expect(make({ daysSinceWeighIn: null }).steps.find((s) => s.id === 'weigh-in')?.done).toBe(
      false,
    );
  });

  it('never mentions periods unless she tracks them', () => {
    expect(ids({ tracksCycle: false, daysSincePeriodLog: 90 })).not.toContain('period');
  });

  it('only raises a period once it is well past due', () => {
    expect(ids({ tracksCycle: true, daysSincePeriodLog: 20 })).not.toContain('period');
    expect(ids({ tracksCycle: true, daysSincePeriodLog: 40 })).toContain('period');
    expect(ids({ tracksCycle: true, daysSincePeriodLog: null })).toContain('period');
  });

  it('reports a clear day as having nothing next', () => {
    const summary = make({
      checkedIn: true,
      trainedToday: true,
      mealsLoggedToday: 3,
      proteinG: 130,
      daysSinceWeighIn: 0,
    });
    expect(summary.next).toBeNull();
    expect(summary.done).toBe(summary.total);
  });

  it('sends every step somewhere that exists', () => {
    const screens = new Set(['today', 'fuel', 'coach', 'progress', 'you']);
    for (const step of make({ tracksCycle: true, nutritionReady: false }).steps) {
      expect(screens.has(step.screen)).toBe(true);
    }
  });
});

describe('rest days', () => {
  it('counts a rest day as done and names the next session', () => {
    const result = make({ restDay: true, restDayNext: 'on Thursday' });
    const session = result.steps.find((step) => step.id === 'session')!;
    expect(session.done).toBe(true);
    expect(session.title).toBe('Rest day');
    expect(session.hint).toContain('on Thursday');
  });

  it('is not a rest day once a session is open or done', () => {
    expect(make({ restDay: true, sessionOpen: true }).steps.find((s) => s.id === 'session')!.title).toMatch(/^Finish/);
    expect(make({ restDay: true, trainedToday: true }).steps.find((s) => s.id === 'session')!.title).toBe('Trained today');
  });
});

describe('check-in relevance', () => {
  it('drops the check-in once she has trained or on a rest day, but keeps it if answered', () => {
    expect(ids({ trainedToday: true })).not.toContain('checkin');
    expect(ids({ restDay: true })).not.toContain('checkin');
    expect(ids({ trainedToday: true, checkedIn: true })).toContain('checkin');
    expect(ids()).toContain('checkin');
  });
});

import { describe, expect, it } from 'vitest';
import { renderBriefing, weakSpots, type BriefingInput, type LiftSnapshot } from './coach';
import { makeDefaultProfile, type Profile } from '../db/schema';

const profile = (over: Partial<Profile> = {}): Profile => ({
  ...makeDefaultProfile(),
  id: 'profile',
  updatedAt: 0,
  deletedAt: null,
  schemaVersion: 2,
  onboardedAt: 1,
  ...over,
});

const lift = (over: Partial<LiftSnapshot> = {}): LiftSnapshot => ({
  exerciseId: 'barbell-back-squat',
  name: 'Barbell back squat',
  sessions: 6,
  lastPerformed: '2026-05-20',
  lastWeightKg: 60,
  bestE1rm: 75,
  changeKg: 5,
  trend: 'up',
  stalled: false,
  ...over,
});

const briefing = (over: Partial<BriefingInput> = {}): BriefingInput => ({
  today: '2026-05-25',
  cuisine: 'south-asian',
  profile: profile(),
  programName: 'Full body, three times a week',
  nextDayName: 'Full body A',
  sessionsAllTime: 24,
  sessionsThisMonth: 8,
  sessionsLast28Days: 11,
  lastTrainedDate: '2026-05-24',
  lifts: [lift()],
  recentReadiness: [{ date: '2026-05-24', score: 70, band: 'green' }],
  cycle: null,
  patterns: null,
  nutrition: null,
  intakeToday: null,
  medianProteinG: null,
  daysFoodLogged: 0,
  conditioningMinutes: null,
  bodyWeightTrendKg: null,
  ...over,
});

describe('weak spots', () => {
  it('finds nothing wrong when nothing is wrong', () => {
    expect(weakSpots(briefing())).toEqual([]);
  });

  it('names a stalled lift', () => {
    const spots = weakSpots(briefing({ lifts: [lift({ stalled: true })] }));
    expect(spots.join(' ')).toContain('Barbell back squat');
    expect(spots.join(' ')).toContain('Stalled');
  });

  it('notices a lift she has not done for a month', () => {
    const spots = weakSpots(
      briefing({ lifts: [lift({ lastPerformed: '2026-04-01' })] }),
    );
    expect(spots.join(' ')).toContain('three weeks');
  });

  it('notices attendance falling away', () => {
    const spots = weakSpots(briefing({ sessionsLast28Days: 3 }));
    expect(spots.join(' ')).toContain('Attendance');
  });

  it('says nothing about attendance before she has trained at all', () => {
    // A brand new user has not fallen behind on anything.
    const spots = weakSpots(
      briefing({ sessionsAllTime: 0, sessionsLast28Days: 0, lifts: [] }),
    );
    expect(spots.join(' ')).not.toContain('Attendance');
  });

  it('flags protein only once there is enough logged to judge', () => {
    const nutrition = {
      bmi: null,
      energy: { bmr: 1400, baselineKcal: 1800, trainingKcalPerDay: 150, tdee: 1950 },
      target: {
        kcal: 1950,
        requestedKcal: 1950,
        floor: 'none' as const,
        floorNote: null,
        energyAvailability: 40,
      },
      macros: { proteinG: 110, fatG: 60, carbG: 230, fibreG: 27 },
      waterMl: 2000,
      ffmKg: 45,
      warnings: [],
    };

    const barely = weakSpots(
      briefing({ nutrition, medianProteinG: 60, daysFoodLogged: 1 }),
    );
    expect(barely.join(' ')).not.toContain('Protein');

    const enough = weakSpots(
      briefing({ nutrition, medianProteinG: 60, daysFoodLogged: 6 }),
    );
    expect(enough.join(' ')).toContain('Protein');
  });

  it('mentions missing conditioning only for a hybrid user', () => {
    const empty = { thisWeek: 0, lastWeek: 0 };

    expect(
      weakSpots(briefing({ conditioningMinutes: empty })).join(' '),
    ).not.toContain('Conditioning');

    expect(
      weakSpots(
        briefing({
          profile: profile({ trainingStyle: 'hybrid' }),
          conditioningMinutes: empty,
        }),
      ).join(' '),
    ).toContain('Conditioning');
  });

  it('puts an absent period in the list as a clinician question', () => {
    const spots = weakSpots(
      briefing({
        cycle: {
          stats: {
            starts: [],
            lengths: [],
            completeCycles: 0,
            medianLengthDays: null,
            shortestDays: null,
            longestDays: null,
            variabilityDays: null,
            medianPeriodDays: null,
            confidence: 'none',
          },
          lastStart: '2026-01-01',
          dayOfCycle: 145,
          phase: null,
          assumedLengthDays: null,
          predictedNextStart: null,
          predictedWindow: null,
          daysUntilNext: null,
          daysSinceStart: 144,
          flags: ['absent'],
        },
      }),
    );
    expect(spots.join(' ')).toContain('clinician');
  });
});

describe('the briefing text', () => {
  it('never sends anything that identifies her', () => {
    // The app does not collect a name, and the briefing must not become the
    // place one arrives by accident.
    const text = renderBriefing(briefing({ profile: profile({ displayName: 'Aisha' }) }));
    expect(text).not.toContain('Aisha');
  });

  it('leaves out the cycle section entirely when she does not track it', () => {
    expect(renderBriefing(briefing())).not.toContain('## Cycle');
  });

  it('tells the model not to programme by phase when a cycle is included', () => {
    const text = renderBriefing(
      briefing({
        cycle: {
          stats: {
            starts: ['2026-05-01'],
            lengths: [28],
            completeCycles: 1,
            medianLengthDays: 28,
            shortestDays: 28,
            longestDays: 28,
            variabilityDays: 0,
            medianPeriodDays: 5,
            confidence: 'low',
          },
          lastStart: '2026-05-01',
          dayOfCycle: 25,
          phase: 'luteal',
          assumedLengthDays: 28,
          predictedNextStart: '2026-05-29',
          predictedWindow: ['2026-05-27', '2026-05-31'],
          daysUntilNext: 4,
          daysSinceStart: 24,
          flags: [],
        },
      }),
    );
    expect(text).toContain('## Cycle');
    expect(text).toContain('does not change weights by cycle phase');
  });

  it('omits a fact it does not have rather than printing an empty one', () => {
    // "Body weight: null" in the briefing is how a model ends up telling
    // someone their body weight is null.
    const text = renderBriefing(briefing());
    expect(text).not.toContain('Body weight');
    expect(text).not.toContain('Working around');
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  it('includes a fact it does have', () => {
    const text = renderBriefing(
      briefing({ profile: profile({ bodyWeightKg: 64, limitations: ['knees'] }) }),
    );
    expect(text).toContain('Body weight: 64 kg');
    expect(text).toContain('Working around: knees');
  });
});

import { db } from './db';
import { ensureProfile, stamp, updateProfile } from './repo';
import { dateKey } from '../lib/date';
import type { Checkin, CycleEvent, SetLog, Session, SymptomTag } from './schema';

/**
 * Plausible fake history, so the export/import round-trip and (later) the
 * progression engine can be exercised without training for eight weeks first.
 *
 * Deliberately not random: a fixed seed means the same data every time, which
 * makes "did the import actually restore everything" answerable by eye.
 *
 * Everything is built in memory and written in a single transaction. Writing
 * row by row would fire a live-query invalidation per row, so the dashboard
 * would visibly thrash through a couple of hundred intermediate states before
 * settling - and a half-finished seed would survive a crash.
 */

const EXERCISES = ['barbell-squat', 'romanian-deadlift', 'bench-press', 'lat-pulldown'];

const BASE_WEIGHTS: Record<string, number> = {
  'barbell-squat': 50,
  'romanian-deadlift': 45,
  'bench-press': 30,
  'lat-pulldown': 35,
};

/** Small deterministic PRNG so seeded data is reproducible across runs. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export interface SeedOptions {
  weeks?: number;
  sessionsPerWeek?: number;
}

export interface SeedResult {
  sessions: number;
  sets: number;
  checkins: number;
}

export async function seedDemoData({
  weeks = 8,
  sessionsPerWeek = 3,
}: SeedOptions = {}): Promise<SeedResult> {
  const random = makeRandom(20260901);
  const now = Date.now();
  const DAY = 86_400_000;

  await ensureProfile();
  await updateProfile({
    displayName: 'Demo',
    birthYear: 1996,
    bodyWeightKg: 62,
    heightCm: 165,
    goal: 'muscle',
    experience: 'some',
    location: 'gym',
    equipment: ['barbell', 'dumbbells', 'cable-machine'],
    daysPerWeek: 3,
    cycleTracking: 'track',
    onboardedAt: now - weeks * 7 * DAY,
  });

  const sessions: Session[] = [];
  const sets: SetLog[] = [];
  const checkinsByDate = new Map<string, Checkin>();
  const cycleEvents: CycleEvent[] = [];

  for (let week = weeks - 1; week >= 0; week--) {
    for (let index = 0; index < sessionsPerWeek; index++) {
      const startedAt = now - (week * 7 + index * 2) * DAY - 18 * 3_600_000;

      const session = stamp<Session>({
        startedAt,
        endedAt: startedAt + 55 * 60_000,
        templateId: null,
        notes: null,
      });
      sessions.push(session);

      // Alternate an upper and a lower day.
      const offset = index % 2 === 0 ? 0 : 2;
      for (const exerciseId of EXERCISES.slice(offset, offset + 2)) {
        // Working weights creep up the way double progression actually feels.
        const weight = (BASE_WEIGHTS[exerciseId] ?? 20) + (weeks - 1 - week) * 1.25;

        for (let setIndex = 0; setIndex < 3; setIndex++) {
          sets.push(
            stamp<SetLog>({
              sessionId: session.id,
              exerciseId,
              performedAt: startedAt + setIndex * 4 * 60_000,
              weightKg: Math.round(weight * 2) / 2,
              reps: 8 + Math.floor(random() * 3),
              rir: 1 + Math.floor(random() * 2),
              isWarmup: false,
            }),
          );
        }
      }

      const date = dateKey(new Date(startedAt));
      if (!checkinsByDate.has(date)) {
        const symptoms: SymptomTag[] = random() > 0.75 ? ['poor_sleep'] : [];
        checkinsByDate.set(
          date,
          stamp<Checkin>({
            date,
            sleep: 2 + Math.floor(random() * 4),
            energy: 2 + Math.floor(random() * 4),
            soreness: 1 + Math.floor(random() * 4),
            symptoms,
          }),
        );
      }
    }
  }

  // Three logged period starts, roughly 29 days apart.
  for (const daysAgo of [58, 29, 1]) {
    cycleEvents.push(
      stamp<CycleEvent>({
        date: dateKey(new Date(now - daysAgo * DAY)),
        kind: 'period_start',
      }),
    );
  }

  return db.transaction(
    'rw',
    [db.sessions, db.sets, db.checkins, db.cycleEvents],
    async () => {
      // The date index on check-ins is unique, so skip any day already logged
      // rather than letting bulkPut throw.
      const takenDates = new Set(
        await db.checkins.orderBy('date').keys() as string[],
      );
      const checkins = [...checkinsByDate.values()].filter(
        (checkin) => !takenDates.has(checkin.date),
      );

      const takenEventDates = new Set(
        (await db.cycleEvents.toArray()).map((event) => event.date),
      );
      const events = cycleEvents.filter((event) => !takenEventDates.has(event.date));

      await Promise.all([
        db.sessions.bulkPut(sessions),
        db.sets.bulkPut(sets),
        db.checkins.bulkPut(checkins),
        db.cycleEvents.bulkPut(events),
      ]);

      return {
        sessions: sessions.length,
        sets: sets.length,
        checkins: checkins.length,
      };
    },
  );
}

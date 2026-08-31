import { beforeEach, describe, expect, it } from 'vitest';
import { liveQuery } from 'dexie';
import { db } from './db';
import { create } from './repo';
import { wipeAll } from './export';
import type { CycleEvent } from './schema';

/**
 * The dashboard derives every number from the log on read. That only stays
 * true on screen if the queries are actually live, so the reactivity itself is
 * under test - a count that only refreshes on reload is a silent regression.
 */

function collect<T>(query: () => Promise<T>) {
  const values: T[] = [];
  const subscription = liveQuery(query).subscribe((value) => values.push(value));
  return {
    values,
    stop: () => subscription.unsubscribe(),
  };
}

/** liveQuery notifies asynchronously; give it a turn or two to catch up. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

beforeEach(async () => {
  await wipeAll();
});

describe('liveQuery reactivity', () => {
  it('re-emits a plain table count after a write', async () => {
    const sub = collect(() => db.cycleEvents.count());
    await settle();
    expect(sub.values.at(-1)).toBe(0);

    await create<CycleEvent>(db.cycleEvents, { date: '2026-05-01', kind: 'period_start' });
    await settle();

    expect(sub.values.at(-1)).toBe(1);
    sub.stop();
  });

  it('re-emits a filtered count after a write', async () => {
    const sub = collect(() =>
      db.cycleEvents.filter((row) => row.deletedAt === null).count(),
    );
    await settle();
    expect(sub.values.at(-1)).toBe(0);

    await create<CycleEvent>(db.cycleEvents, { date: '2026-05-02', kind: 'period_start' });
    await settle();

    expect(sub.values.at(-1)).toBe(1);
    sub.stop();
  });

  it('re-emits when several queries are awaited in one subscription', async () => {
    const sub = collect(async () => ({
      events: await db.cycleEvents.filter((row) => row.deletedAt === null).count(),
      sets: await db.sets.filter((row) => row.deletedAt === null).count(),
    }));
    await settle();
    expect(sub.values.at(-1)).toEqual({ events: 0, sets: 0 });

    await create<CycleEvent>(db.cycleEvents, { date: '2026-05-03', kind: 'period_start' });
    await settle();

    expect(sub.values.at(-1)).toEqual({ events: 1, sets: 0 });
    sub.stop();
  });
});

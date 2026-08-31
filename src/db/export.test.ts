import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { create, remove } from './repo';
import { exportAll, importBundle, parseBundle, wipeAll } from './export';
import { seedDemoData } from './seed';
import { uuidv7 } from '../lib/id';
import { addDays, dateKey, daysBetween } from '../lib/date';
import type { Checkin, CycleEvent } from './schema';

/** Simulates the file actually going to disk and coming back. */
function throughFile(value: unknown) {
  return parseBundle(JSON.stringify(value, null, 2));
}

beforeEach(async () => {
  await wipeAll();
});

describe('export / import round-trip', () => {
  it('restores every row after the database is wiped', async () => {
    const seeded = await seedDemoData({ weeks: 4 });
    const before = await exportAll();

    expect(before.data.sessions.length).toBe(seeded.sessions);
    expect(before.data.sets.length).toBe(seeded.sets);
    expect(before.data.sets.length).toBeGreaterThan(0);

    await wipeAll();
    expect(await db.sets.count()).toBe(0);

    const parsed = throughFile(before);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const report = await importBundle(parsed.bundle);
    expect(report.total.added).toBe(
      before.data.profile.length +
        before.data.sessions.length +
        before.data.sets.length +
        before.data.checkins.length +
        before.data.cycleEvents.length,
    );
    expect(report.total.invalid).toBe(0);

    const after = await exportAll();
    const byId = <T extends { id: string }>(rows: T[]) =>
      [...rows].sort((a, b) => a.id.localeCompare(b.id));

    expect(byId(after.data.sets)).toEqual(byId(before.data.sets));
    expect(byId(after.data.sessions)).toEqual(byId(before.data.sessions));
    expect(byId(after.data.checkins)).toEqual(byId(before.data.checkins));
    expect(byId(after.data.profile)).toEqual(byId(before.data.profile));
  });

  it('is idempotent - importing the same file twice changes nothing', async () => {
    await seedDemoData({ weeks: 2 });
    const bundle = await exportAll();

    const parsed = throughFile(bundle);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const second = await importBundle(parsed.bundle);
    expect(second.total.added).toBe(0);
    expect(second.total.updated).toBe(0);
    expect(second.total.skippedOlder).toBeGreaterThan(0);
  });

  it('keeps the newer record on conflict, in both directions', async () => {
    const event = await create<CycleEvent>(db.cycleEvents, {
      date: '2026-08-01',
      kind: 'period_start',
    });
    const bundle = await exportAll();

    // Local row is edited after the export was taken: the export must lose.
    await db.cycleEvents.put({ ...event, kind: 'spotting', updatedAt: event.updatedAt + 1000 });
    const parsedOld = throughFile(bundle);
    expect(parsedOld.ok).toBe(true);
    if (!parsedOld.ok) return;

    const stale = await importBundle(parsedOld.bundle);
    expect(stale.cycleEvents.skippedOlder).toBe(1);
    expect((await db.cycleEvents.get(event.id))?.kind).toBe('spotting');

    // A file newer than the local row must win.
    const newer = {
      ...bundle,
      data: {
        ...bundle.data,
        cycleEvents: [{ ...event, kind: 'period_end', updatedAt: Date.now() + 60_000 }],
      },
    };
    const parsedNew = throughFile(newer);
    expect(parsedNew.ok).toBe(true);
    if (!parsedNew.ok) return;

    const fresh = await importBundle(parsedNew.bundle);
    expect(fresh.cycleEvents.updated).toBe(1);
    expect((await db.cycleEvents.get(event.id))?.kind).toBe('period_end');
  });

  it('carries tombstones so deletions are not resurrected', async () => {
    const event = await create<CycleEvent>(db.cycleEvents, {
      date: '2026-07-04',
      kind: 'period_start',
    });
    await remove(db.cycleEvents, event.id);

    const bundle = await exportAll();
    expect(bundle.data.cycleEvents).toHaveLength(1);
    expect(bundle.data.cycleEvents[0]?.deletedAt).toBeTypeOf('number');

    await wipeAll();
    const parsed = throughFile(bundle);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await importBundle(parsed.bundle);

    const restored = await db.cycleEvents.get(event.id);
    expect(restored?.deletedAt).toBeTypeOf('number');
  });

  it('resolves two check-ins claiming the same date', async () => {
    // She checked in on her phone and her laptop on the same day: two rows,
    // different ids, one unique date index. A naive put would throw here.
    const local = await create<Checkin>(db.checkins, {
      date: '2026-08-15',
      sleep: 2,
      energy: 2,
      soreness: 4,
      symptoms: [],
    });

    const incoming: Checkin = {
      ...local,
      id: uuidv7(),
      sleep: 5,
      energy: 5,
      updatedAt: local.updatedAt + 5_000,
    };

    const bundle = await exportAll();
    const parsed = throughFile({ ...bundle, data: { ...bundle.data, checkins: [incoming] } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const report = await importBundle(parsed.bundle);
    expect(report.checkins.updated).toBe(1);

    const rows = await db.checkins.where('date').equals('2026-08-15').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.energy).toBe(5);
  });
});

describe('parseBundle', () => {
  it('rejects files that are not exports from this app', async () => {
    expect(parseBundle('not json at all').ok).toBe(false);
    expect(parseBundle('{"format":"something-else"}').ok).toBe(false);
    expect(parseBundle('[]').ok).toBe(false);

    const future = await exportAll();
    const result = parseBundle(JSON.stringify({ ...future, schemaVersion: 999 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('newer version');
  });

  it('counts malformed rows instead of throwing', async () => {
    const bundle = await exportAll();
    const parsed = throughFile({
      ...bundle,
      data: { ...bundle.data, sets: [{ nonsense: true }, { id: 'x' }] },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const report = await importBundle(parsed.bundle);
    expect(report.sets.invalid).toBe(2);
    expect(report.sets.added).toBe(0);
  });
});

describe('uuidv7', () => {
  it('is well-formed and sorts chronologically', () => {
    const id = uuidv7();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const ids = Array.from({ length: 200 }, () => uuidv7());
    expect(new Set(ids).size).toBe(200);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('date keys', () => {
  it('counts whole days across a daylight-saving boundary', () => {
    // Europe/London springs forward on 2026-03-29. Naive ms arithmetic on
    // local dates returns 0 days here; cycle length maths depends on 1.
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1);
    expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1);
    expect(daysBetween('2026-08-01', '2026-08-29')).toBe(28);
  });

  it('round-trips through addDays', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-01-01', addDays('2026-01-01', 45))).toBe(45);
  });

  it('uses the local calendar day, not UTC', () => {
    const lateEvening = new Date(2026, 8, 1, 23, 30);
    expect(dateKey(lateEvening)).toBe('2026-09-01');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { create } from './repo';
import { exportAll, importBundle, wipeAll } from './export';
import { addSupplement, removeSupplement, setSupplementTaken } from './actions';
import { getSupplementChecklist } from './queries';
import type { SupplementIntake } from './schema';

beforeEach(async () => {
  await wipeAll();
});

describe('supplement checklist', () => {
  it('ticks once, and ticking again does not double up', async () => {
    const iron = await addSupplement({ name: 'Iron', dose: '1 tablet', timing: 'with-food', note: null });
    await setSupplementTaken(iron.id, true, '2026-09-22');
    await setSupplementTaken(iron.id, true, '2026-09-22');

    const list = await getSupplementChecklist('2026-09-22');
    expect(list.taken).toBe(1);
    expect(await db.supplementIntake.count()).toBe(1);
  });

  it('unticking removes every live tick for that day, including a duplicate from another device', async () => {
    const iron = await addSupplement({ name: 'Iron', dose: null, timing: 'any', note: null });
    await setSupplementTaken(iron.id, true, '2026-09-22');
    // A second device wrote its own row for the same day before syncing.
    await create<SupplementIntake>(db.supplementIntake, { supplementId: iron.id, date: '2026-09-22' });
    expect((await getSupplementChecklist('2026-09-22')).taken).toBe(1);

    await setSupplementTaken(iron.id, false, '2026-09-22');
    const list = await getSupplementChecklist('2026-09-22');
    expect(list.taken).toBe(0);
    // Soft-deleted, so the untick travels to the other device too.
    const rows = await db.supplementIntake.toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it('a removed supplement leaves the list but its history stays', async () => {
    const d = await addSupplement({ name: 'Vitamin D', dose: '2000 IU', timing: 'morning', note: null });
    await setSupplementTaken(d.id, true, '2026-09-20');
    await removeSupplement(d.id);

    expect((await getSupplementChecklist('2026-09-20')).total).toBe(0);
    expect(await db.supplementIntake.count()).toBe(1);
  });

  it('round-trips through export and import', async () => {
    const iron = await addSupplement({ name: 'Iron', dose: '1 tablet', timing: 'with-food', note: 'Dr said so' });
    await setSupplementTaken(iron.id, true, '2026-09-22');
    const bundle = await exportAll();
    expect(bundle.schemaVersion).toBe(3);
    expect(bundle.data.supplements).toHaveLength(1);
    expect(bundle.data.supplementIntake).toHaveLength(1);

    await wipeAll();
    const report = await importBundle(bundle);
    expect(report.supplements.added).toBe(1);
    expect(report.supplementIntake.added).toBe(1);
    expect((await getSupplementChecklist('2026-09-22')).taken).toBe(1);
  });

  it('imports a v2 file that has never heard of supplements', async () => {
    const bundle = await exportAll();
    const old = {
      ...bundle,
      schemaVersion: 2,
      data: { ...bundle.data, supplements: undefined, supplementIntake: undefined },
    };
    const report = await importBundle(old as never);
    expect(report.supplements.added).toBe(0);
    expect(report.total.invalid).toBe(0);
  });
});

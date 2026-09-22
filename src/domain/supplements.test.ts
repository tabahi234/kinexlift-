import { describe, expect, it } from 'vitest';
import type { Supplement, SupplementIntake } from '../db/schema';
import {
  buildChecklist,
  describeSupplement,
  normaliseSupplement,
  NAME_MAX,
  SUPPLEMENT_PRESETS,
  TIMING_ORDER,
} from './supplements';

const meta = { updatedAt: 1, deletedAt: null, schemaVersion: 3 };

const supplement = (id: string, over: Partial<Supplement> = {}): Supplement => ({
  id,
  ...meta,
  name: id,
  dose: null,
  timing: 'any',
  note: null,
  ...over,
});

const tick = (id: string, supplementId: string, date: string, over: Partial<SupplementIntake> = {}): SupplementIntake => ({
  id,
  ...meta,
  supplementId,
  date,
  ...over,
});

describe('normaliseSupplement', () => {
  it('refuses a blank name and trims everything else', () => {
    expect(normaliseSupplement({ name: '   ' })).toBeNull();
    expect(normaliseSupplement({ name: ' Iron ', dose: ' 1 tablet ', note: '' })).toEqual({
      name: 'Iron',
      dose: '1 tablet',
      timing: 'any',
      note: null,
    });
  });

  it('caps lengths and falls back to "any" for an unknown timing', () => {
    const long = 'x'.repeat(NAME_MAX + 50);
    const row = normaliseSupplement({
      name: long,
      timing: 'midnight' as never,
    });
    expect(row?.name).toHaveLength(NAME_MAX);
    expect(row?.timing).toBe('any');
  });
});

describe('buildChecklist', () => {
  it('lists live supplements in the order of the day, and marks what was taken today', () => {
    const rows = [
      supplement('mag', { name: 'Magnesium', timing: 'evening' }),
      supplement('iron', { name: 'Iron', timing: 'with-food' }),
      supplement('d', { name: 'Vitamin D', timing: 'morning' }),
      supplement('gone', { name: 'Old one', deletedAt: 5 }),
    ];
    const intake = [
      tick('t1', 'iron', '2026-09-22'),
      tick('t2', 'mag', '2026-09-21'),
      tick('t3', 'd', '2026-09-22', { deletedAt: 9 }),
    ];
    const list = buildChecklist(rows, intake, '2026-09-22');
    expect(list.rows.map((row) => row.supplement.name)).toEqual(['Vitamin D', 'Iron', 'Magnesium']);
    expect(list.rows.map((row) => row.taken)).toEqual([false, true, false]);
    expect(list.taken).toBe(1);
    expect(list.total).toBe(3);
  });

  it('keeps the newest tick when two devices ticked the same day', () => {
    const rows = [supplement('iron')];
    const intake = [
      tick('old', 'iron', '2026-09-22', { updatedAt: 1 }),
      tick('new', 'iron', '2026-09-22', { updatedAt: 2 }),
    ];
    const list = buildChecklist(rows, intake, '2026-09-22');
    expect(list.rows[0]!.intake?.id).toBe('new');
  });

  it('is empty when she takes nothing', () => {
    expect(buildChecklist([], [], '2026-09-22')).toEqual({ rows: [], taken: 0, total: 0 });
  });
});

describe('describeSupplement', () => {
  it('joins dose and timing, and copes without a dose', () => {
    expect(describeSupplement({ dose: '1 tablet', timing: 'with-food' })).toBe('1 tablet · With food');
    expect(describeSupplement({ dose: null, timing: 'evening' })).toBe('Evening');
  });
});

describe('presets', () => {
  it('every preset has a timing the checklist knows how to sort', () => {
    for (const preset of SUPPLEMENT_PRESETS) {
      expect(TIMING_ORDER).toContain(preset.timing);
    }
  });

  it('offers nothing with calories - those are food', () => {
    const names = SUPPLEMENT_PRESETS.map((preset) => preset.name.toLowerCase());
    expect(names.some((name) => /protein|whey|gainer|bar/.test(name))).toBe(false);
  });
});

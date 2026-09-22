import type { Supplement, SupplementIntake, SupplementTiming } from '../db/schema';

/**
 * Supplements.
 *
 * Asked for in the first round of testing, on a doctor's recommendation, and
 * built as narrowly as that recommendation was made: a list of what she
 * takes, and a tick for each day she took it. The app never suggests one.
 * The coach's system prompt already forbids it from discussing supplements
 * beyond ordinary food, and nothing here changes that.
 *
 * Powders with calories - whey, a protein bar - are food, and stay in the
 * food table where their calories count. This is for the things that do
 * not go on a plate.
 */

export const TIMING_ORDER: SupplementTiming[] = [
  'morning',
  'with-food',
  'before-training',
  'after-training',
  'evening',
  'any',
];

export const TIMING_LABEL: Record<SupplementTiming, string> = {
  morning: 'Morning',
  'with-food': 'With food',
  'before-training': 'Before training',
  'after-training': 'After training',
  evening: 'Evening',
  any: 'Any time',
};

/**
 * Names offered as chips when she adds one, so the common case is a tap
 * rather than a keyboard. Timings are the usual packet instruction, and
 * every one is editable. No doses: the dose is on her prescription, not in
 * this file.
 */
export const SUPPLEMENT_PRESETS: { name: string; timing: SupplementTiming }[] = [
  { name: 'Iron', timing: 'with-food' },
  { name: 'Vitamin D', timing: 'with-food' },
  { name: 'Calcium', timing: 'with-food' },
  { name: 'Folic acid', timing: 'morning' },
  { name: 'Vitamin B12', timing: 'morning' },
  { name: 'Multivitamin', timing: 'with-food' },
  { name: 'Omega-3', timing: 'with-food' },
  { name: 'Magnesium', timing: 'evening' },
  { name: 'Creatine', timing: 'any' },
  { name: 'Zinc', timing: 'with-food' },
];

export const NAME_MAX = 60;
export const DOSE_MAX = 40;
export const NOTE_MAX = 300;

export type SupplementDraft = {
  name: string;
  dose: string | null;
  timing: SupplementTiming;
  note: string | null;
};

/**
 * Cleans what she typed into something the row can hold. Returns null when
 * there is no name, which is the only thing that makes a row meaningless.
 */
export function normaliseSupplement(input: {
  name: string;
  dose?: string | null;
  timing?: SupplementTiming | null;
  note?: string | null;
}): SupplementDraft | null {
  const name = input.name.trim().slice(0, NAME_MAX);
  if (name === '') return null;
  const dose = (input.dose ?? '').trim().slice(0, DOSE_MAX);
  const note = (input.note ?? '').trim().slice(0, NOTE_MAX);
  return {
    name,
    dose: dose === '' ? null : dose,
    timing: input.timing && TIMING_ORDER.includes(input.timing) ? input.timing : 'any',
    note: note === '' ? null : note,
  };
}

export interface ChecklistRow {
  supplement: Supplement;
  /** The intake row for this day, when she has ticked it. */
  intake: SupplementIntake | null;
  taken: boolean;
}

export interface Checklist {
  rows: ChecklistRow[];
  taken: number;
  total: number;
}

/**
 * Today's checklist: every live supplement, in the order of the day, with
 * whether it has been ticked. Deleted supplements and deleted ticks are both
 * ignored - untick is a soft delete so it can travel to another device.
 */
export function buildChecklist(
  supplements: Supplement[],
  intake: SupplementIntake[],
  date: string,
): Checklist {
  const live = supplements.filter((row) => row.deletedAt === null);
  const ticks = new Map<string, SupplementIntake>();
  for (const row of intake) {
    if (row.deletedAt !== null || row.date !== date) continue;
    // Two devices can each write a tick for the same day. Keep the newest;
    // the action that unticks removes every one it finds.
    const existing = ticks.get(row.supplementId);
    if (!existing || row.updatedAt > existing.updatedAt) ticks.set(row.supplementId, row);
  }

  const rows = live
    .map((supplement) => {
      const tick = ticks.get(supplement.id) ?? null;
      return { supplement, intake: tick, taken: tick !== null };
    })
    .sort(
      (a, b) =>
        TIMING_ORDER.indexOf(a.supplement.timing) - TIMING_ORDER.indexOf(b.supplement.timing) ||
        a.supplement.name.localeCompare(b.supplement.name),
    );

  return {
    rows,
    taken: rows.filter((row) => row.taken).length,
    total: rows.length,
  };
}

/** One line for a row: "1 tablet · With food", or just the timing. */
export function describeSupplement(supplement: Pick<Supplement, 'dose' | 'timing'>): string {
  const parts = [supplement.dose, TIMING_LABEL[supplement.timing]].filter(
    (part): part is string => part !== null && part !== '',
  );
  return parts.join(' · ');
}

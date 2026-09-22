import type { Table } from 'dexie';
import { releaseSyncOwnership } from '../lib/sync';
import { db } from './db';
import { SCHEMA_VERSION } from './schema';
import type {
  BodyMetric,
  ChatMessage,
  Checkin,
  CoachNote,
  ConditioningLog,
  CycleEvent,
  MealLog,
  Profile,
  SetLog,
  Session,
  Supplement,
  SupplementIntake,
  SyncMeta,
} from './schema';
import { APP_SLUG } from '../config';

/**
 * Export and import.
 *
 * The export file is deliberately the same shape as the eventual sync
 * payload: same field names, same ids, same merge rule. That means the
 * migration to a real database is already testable today, before a server
 * exists - and a user who exports from local storage can upload the very same
 * file into her account later.
 */

export const EXPORT_FORMAT = 'kinexlift-export';

export interface ExportData {
  profile: Profile[];
  sessions: Session[];
  sets: SetLog[];
  checkins: Checkin[];
  cycleEvents: CycleEvent[];
  conditioning: ConditioningLog[];
  bodyMetrics: BodyMetric[];
  meals: MealLog[];
  /** Absent from a file written before v3. */
  supplements?: Supplement[];
  supplementIntake?: SupplementIntake[];
  /**
   * Conversation, included only when she asks for it.
   *
   * A chat log is the one thing in here she is most likely to want gone, and
   * nothing the app displays is reconstructed from it - so the default export,
   * which is also what a backup file becomes, leaves it out.
   */
  chat?: ChatMessage[];
  coachNotes?: CoachNote[];
}

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  app: string;
  schemaVersion: number;
  exportedAt: number;
  data: ExportData;
}

export interface TableReport {
  added: number;
  updated: number;
  skippedOlder: number;
  invalid: number;
}

export type ImportReport = Record<keyof ExportData, TableReport> & {
  total: TableReport;
};

const TABLE_KEYS = [
  'profile',
  'sessions',
  'sets',
  'checkins',
  'cycleEvents',
  'conditioning',
  'bodyMetrics',
  'meals',
  'chat',
  'coachNotes',
  'supplements',
  'supplementIntake',
] as const;

const emptyReport = (): TableReport => ({
  added: 0,
  updated: 0,
  skippedOlder: 0,
  invalid: 0,
});

/* -------------------------------- export -------------------------------- */

/**
 * Soft-deleted rows are included on purpose. Tombstones have to travel, or an
 * import would resurrect everything the user deleted.
 */
export async function exportAll(
  options: { includeConversation?: boolean } = {},
): Promise<ExportBundle> {
  const [
    profile,
    sessions,
    sets,
    checkins,
    cycleEvents,
    conditioning,
    bodyMetrics,
    meals,
    supplements,
    supplementIntake,
  ] = await Promise.all([
    db.profile.toArray(),
    db.sessions.toArray(),
    db.sets.toArray(),
    db.checkins.toArray(),
    db.cycleEvents.toArray(),
    db.conditioning.toArray(),
    db.bodyMetrics.toArray(),
    db.meals.toArray(),
    db.supplements.toArray(),
    db.supplementIntake.toArray(),
  ]);

  const data: ExportData = {
    profile,
    sessions,
    sets,
    checkins,
    cycleEvents,
    conditioning,
    bodyMetrics,
    meals,
    supplements,
    supplementIntake,
  };

  if (options.includeConversation) {
    data.chat = await db.chat.toArray();
    data.coachNotes = await db.coachNotes.toArray();
  }

  return {
    format: EXPORT_FORMAT,
    app: APP_SLUG,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    data,
  };
}

export function exportFilename(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return APP_SLUG + '-' + y + '-' + m + '-' + d + '.json';
}

export async function downloadExport(): Promise<void> {
  const bundle = await exportAll();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename();
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/* -------------------------------- import -------------------------------- */

export type ParseResult =
  | { ok: true; bundle: ExportBundle }
  | { ok: false; error: string };

function isSyncRecord(value: unknown): value is SyncMeta {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt) &&
    (record.deletedAt === null || typeof record.deletedAt === 'number')
  );
}

/** Never trust a file off disk - it may be hand-edited, or from another app. */
export function parseBundle(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'That file does not look like an export.' };
  }

  const bundle = raw as Partial<ExportBundle>;

  if (bundle.format !== EXPORT_FORMAT) {
    return { ok: false, error: 'That file is not an export from this app.' };
  }
  if (typeof bundle.schemaVersion !== 'number') {
    return { ok: false, error: 'The export is missing its version number.' };
  }
  if (bundle.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        'That export came from a newer version of the app. Update the app, then import again.',
    };
  }
  if (typeof bundle.data !== 'object' || bundle.data === null) {
    return { ok: false, error: 'The export has no data in it.' };
  }

  return { ok: true, bundle: migrate(bundle as ExportBundle) };
}

/**
 * Upgrades an older export in memory to the current schema.
 *
 * Adding version 3 means adding a `case 2:` here, a Dexie `.version(3)` block
 * in db.ts, and bumping SCHEMA_VERSION. Exports written today keep working
 * forever.
 */
function migrate(bundle: ExportBundle): ExportBundle {
  let current = bundle;
  for (let version = current.schemaVersion; version < SCHEMA_VERSION; version++) {
    switch (version) {
      case 1:
        // v2 added conditioning, body metrics and meal logs. A v1 file has
        // none of those tables, and the merge below iterates over the keys it
        // finds - so the upgrade is to give them empty arrays rather than let
        // `undefined` reach mergeTable. The v2 profile fields are all
        // optional and resolved by domain/profile.ts, so old profile rows
        // need no rewriting at all.
        current = {
          ...current,
          schemaVersion: 2,
          data: {
            ...current.data,
            conditioning: current.data.conditioning ?? [],
            bodyMetrics: current.data.bodyMetrics ?? [],
            meals: current.data.meals ?? [],
          },
        };
        break;
      case 2:
        // v3 added supplements. Same shape of upgrade as v1 -> v2: the two
        // new tables get empty arrays and nothing else moves.
        current = {
          ...current,
          schemaVersion: 3,
          data: {
            ...current.data,
            supplements: current.data.supplements ?? [],
            supplementIntake: current.data.supplementIntake ?? [],
          },
        };
        break;
      default:
        current = { ...current, schemaVersion: version + 1 };
    }
  }
  return current;
}

/**
 * Merges a bundle into the local database.
 *
 * The conflict rule is last-write-wins per record on updatedAt. It is the same
 * rule the server will use, so import and sync can never disagree.
 */
export async function importBundle(bundle: ExportBundle): Promise<ImportReport> {
  const report: ImportReport = {
    profile: emptyReport(),
    sessions: emptyReport(),
    sets: emptyReport(),
    checkins: emptyReport(),
    cycleEvents: emptyReport(),
    conditioning: emptyReport(),
    bodyMetrics: emptyReport(),
    meals: emptyReport(),
    chat: emptyReport(),
    coachNotes: emptyReport(),
    supplements: emptyReport(),
    supplementIntake: emptyReport(),
    total: emptyReport(),
  };

  await db.transaction(
    'rw',
    [
      db.profile,
      db.sessions,
      db.sets,
      db.checkins,
      db.cycleEvents,
      db.conditioning,
      db.bodyMetrics,
      db.meals,
      db.chat,
      db.coachNotes,
      db.supplements,
      db.supplementIntake,
    ],
    async () => {
      await mergeTable(db.profile, bundle.data.profile, report.profile);
      await mergeTable(db.sessions, bundle.data.sessions, report.sessions);
      await mergeTable(db.sets, bundle.data.sets, report.sets);
      await mergeByDate(db.checkins, bundle.data.checkins, report.checkins);
      await mergeTable(db.cycleEvents, bundle.data.cycleEvents, report.cycleEvents);
      await mergeTable(db.conditioning, bundle.data.conditioning, report.conditioning);
      await mergeByDate(db.bodyMetrics, bundle.data.bodyMetrics, report.bodyMetrics);
      await mergeTable(db.meals, bundle.data.meals, report.meals);
      // Absent from most files, and absent is not an error: mergeTable
      // ignores anything that is not an array.
      await mergeTable(db.chat, bundle.data.chat, report.chat);
      await mergeTable(db.coachNotes, bundle.data.coachNotes, report.coachNotes);
      await mergeTable(db.supplements, bundle.data.supplements, report.supplements);
      await mergeTable(db.supplementIntake, bundle.data.supplementIntake, report.supplementIntake);
    },
  );

  for (const key of TABLE_KEYS) {
    report.total.added += report[key].added;
    report.total.updated += report[key].updated;
    report.total.skippedOlder += report[key].skippedOlder;
    report.total.invalid += report[key].invalid;
  }

  return report;
}

async function mergeTable<T extends SyncMeta>(
  table: Table<T, string>,
  incoming: unknown,
  report: TableReport,
): Promise<void> {
  if (!Array.isArray(incoming)) return;

  for (const candidate of incoming) {
    if (!isSyncRecord(candidate)) {
      report.invalid++;
      continue;
    }
    const record = candidate as T;
    const existing = await table.get(record.id);

    if (!existing) {
      await table.put(record);
      report.added++;
    } else if (record.updatedAt > existing.updatedAt) {
      await table.put(record);
      report.updated++;
    } else {
      report.skippedOlder++;
    }
  }
}

/**
 * Merge for tables with a unique `date` index - check-ins and weigh-ins.
 *
 * An incoming row can collide with a local row that has a different id: she
 * checked in on both her phone and her laptop the same morning. A plain put
 * would throw on the unique index, so the collision is resolved by date, with
 * the same last-write-wins rule used everywhere else.
 */
async function mergeByDate<T extends SyncMeta & { date: string }>(
  table: Table<T, string>,
  incoming: unknown,
  report: TableReport,
): Promise<void> {
  if (!Array.isArray(incoming)) return;

  for (const candidate of incoming) {
    if (!isSyncRecord(candidate) || typeof (candidate as T).date !== 'string') {
      report.invalid++;
      continue;
    }
    const record = candidate as T;

    const byId = await table.get(record.id);
    if (byId) {
      if (record.updatedAt > byId.updatedAt) {
        await table.put(record);
        report.updated++;
      } else {
        report.skippedOlder++;
      }
      continue;
    }

    const byDate = await table.where('date').equals(record.date).first();
    if (byDate) {
      if (record.updatedAt > byDate.updatedAt) {
        await table.delete(byDate.id);
        await table.put(record);
        report.updated++;
      } else {
        report.skippedOlder++;
      }
      continue;
    }

    await table.put(record);
    report.added++;
  }
}

/* -------------------------------- danger -------------------------------- */

export async function wipeAll(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.profile,
      db.sessions,
      db.sets,
      db.checkins,
      db.cycleEvents,
      db.conditioning,
      db.bodyMetrics,
      db.meals,
      db.chat,
      db.coachNotes,
      db.supplements,
      db.supplementIntake,
    ],
    async () => {
      await Promise.all([
        db.profile.clear(),
        db.sessions.clear(),
        db.sets.clear(),
        db.checkins.clear(),
        db.cycleEvents.clear(),
        db.conditioning.clear(),
        db.bodyMetrics.clear(),
        db.meals.clear(),
        db.chat.clear(),
        db.coachNotes.clear(),
        db.supplements.clear(),
        db.supplementIntake.clear(),
      ]);
    },
  );

  // Erasing the log is the one action that genuinely makes this device
  // nobody's, so the backup ownership marker goes with it. Without this, a
  // device wiped and handed on would refuse to back up as its new owner.
  releaseSyncOwnership();
}

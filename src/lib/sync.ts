import type { Table } from 'dexie';
import { db, TABLE_NAMES, type TableName } from '../db/db';
import { getProfile } from '../db/repo';
import { cloudSyncEnabled } from '../domain/profile';
import { getSupabase, supabaseConfigured } from './supabase';
import { checkOwnership } from '../domain/account';
import type { SyncMeta } from '../db/schema';

/**
 * Optional cloud backup.
 *
 * Three things about this are deliberate, and all three are corrections to the
 * first version of this file.
 *
 * 1. It is off unless she turned it on. The onboarding screen says in writing
 *    that nothing is uploaded. Uploading her period history on app start
 *    because a Supabase key happened to be in the build would make that a lie,
 *    and menstrual data is special-category data under GDPR.
 *
 * 2. It requires sign in. An authenticated session gives every device a
 *    real user id, which is what row-level security needs to key on. Writing
 *    to an open table would put every user's training log in one bucket that
 *    any other user could read.
 *
 * 3. It is incremental and two-way, using the same last-write-wins rule as the
 *    export file. Pushing every row on every run got slower every week she
 *    used the app, and never pulling meant a second device could not work.
 *
 * 4. The device remembers whose data it holds, and refuses to upload one
 *    person's log into another person's account. This was a real hole and
 *    not a small one: sign out, let a flatmate sign in on the same browser,
 *    turn backup on, and the first account’s period history went into the
 *    second account - correctly authenticated at every step, which is
 *    exactly why row-level security did not catch it. See domain/account.ts.
 */

/*
 * localStorage, defensively.
 *
 * It is absent in the test environment and it throws outright in some
 * privacy modes and embedded browsers. None of what it holds here is
 * precious - cursors re-derive by re-uploading, and a missing owner marker
 * fails safe by making the device unclaimed - so every access degrades to a
 * shrug rather than taking a backup down with it.
 */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readKey(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    /* Nothing to do about it, and nothing here is worth failing over. */
  }
}

function removeKey(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    /* Same. */
  }
}

const CURSOR_PREFIX = 'sync-cursor:';

/**
 * Which account this device's data belongs to.
 *
 * Set the first time an account backs up, and checked on every run after.
 * It lives in localStorage rather than on the profile row because the
 * profile row is itself synced - an owner marker that travels with the data
 * it is supposed to be guarding is not a guard.
 */
const OWNER_KEY = 'sync-owner';

export function syncOwner(): string | null {
  return readKey(OWNER_KEY);
}

/**
 * Forgets both the owner and the cursors.
 *
 * Called when the local data is erased, which is the one action that
 * genuinely makes this device nobody’s. Signing out does not call it:
 * the log is still hers and she will sign back in.
 */
export function releaseSyncOwnership(): void {
  removeKey(OWNER_KEY);
  resetSyncCursors();
}

export type SyncOutcome =
  | { ok: true; pushed: number; pulled: number }
  | {
      ok: false;
      reason: 'disabled' | 'unconfigured' | 'auth' | 'foreign-data' | 'error';
      message: string;
    };

/*
 * Cursors are per account as well as per table.
 *
 * A shared cursor would tell a second account that everything up to
 * timestamp X had already been sent to it, when in fact it was sent to
 * somebody else - so its first backup would silently skip the whole
 * history it was supposed to be uploading.
 */
function cursorKey(table: TableName, userId: string): string {
  return `${CURSOR_PREFIX}${userId}:${table}`;
}

function readCursor(table: TableName, userId: string): number {
  const raw = readKey(cursorKey(table, userId));
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function writeCursor(table: TableName, userId: string, value: number): void {
  writeKey(cursorKey(table, userId), String(value));
}

/** Clears every cursor, for every account, so the next run re-uploads all. */
export function resetSyncCursors(): void {
  const local = store();
  if (!local) return;
  const stale = Object.keys(local).filter((key) => key.startsWith(CURSOR_PREFIX));
  for (const key of stale) removeKey(key);
}

/**
 * Tables whose rows are unique on `date` as well as on id.
 *
 * The same day can be logged on two devices, producing two different ids for
 * one date. A plain put would throw on the unique index, so those collisions
 * are resolved by date before writing.
 */
const UNIQUE_BY_DATE: TableName[] = ['checkins', 'bodyMetrics'];

async function mergeRow<T extends SyncMeta & { date?: string }>(
  table: Table<T, string>,
  name: TableName,
  row: T,
): Promise<boolean> {
  const existing = await table.get(row.id);
  if (existing) {
    if (row.updatedAt <= existing.updatedAt) return false;
    await table.put(row);
    return true;
  }

  if (UNIQUE_BY_DATE.includes(name) && row.date) {
    const clash = await table.where('date').equals(row.date).first();
    if (clash) {
      if (row.updatedAt <= clash.updatedAt) return false;
      await table.delete(clash.id);
      await table.put(row);
      return true;
    }
  }

  await table.put(row);
  return true;
}

/**
 * Makes sure there is a session to attach rows to.
 *
 * Cloud backup now requires a real account rather than an anonymous session
 * so that users can retrieve their data on other devices.
 */
async function ensureSession(): Promise<{ userId: string } | { error: string }> {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return { userId: data.session.user.id };

  return { error: 'Sign in above and this will start working. Nothing is lost in the meantime: everything is still on this device.' };
}

/**
 * Stamps the row with its owner.
 *
 * The server does not take our word for it: the row-level security policy
 * carries `with check (user_id = auth.uid())`, so a client that stamped
 * somebody else’s id here would simply be refused. This is the honest
 * value, sent so the upsert has a conflict target to key on.
 */
function forUpload(row: Record<string, unknown>, userId: string): Record<string, unknown> {
  return { ...row, user_id: userId };
}

/** Whether there is anything here worth worrying about losing. */
async function hasLocalData(): Promise<boolean> {
  for (const name of TABLE_NAMES) {
    if (name === 'profile') continue;
    if ((await db.table(name).count()) > 0) return true;
  }
  return false;
}

export async function syncNow(): Promise<SyncOutcome> {
  if (!supabaseConfigured()) {
    return { ok: false, reason: 'unconfigured', message: 'Backup is not configured.' };
  }

  const profile = await getProfile();
  if (!profile || !cloudSyncEnabled(profile)) {
    return { ok: false, reason: 'disabled', message: 'Backup is off.' };
  }

  const session = await ensureSession();
  if ('error' in session) {
    return { ok: false, reason: 'auth', message: session.error };
  }

  // Whose log is this? Checked before anything is pushed, because the
  // damage is done by the first upload and cannot be taken back: once a row
  // carries somebody else's user_id it is legitimately theirs to read.
  const verdict = checkOwnership(syncOwner(), session.userId, await hasLocalData());
  if (!verdict.ok) {
    return { ok: false, reason: 'foreign-data', message: verdict.message };
  }
  if (verdict.claim) writeKey(OWNER_KEY, session.userId);

  const supabase = await getSupabase();

  let pushed = 0;
  let pulled = 0;

  for (const name of TABLE_NAMES) {
    const table = db.table(name) as Table<SyncMeta & { date?: string }, string>;
    const cursor = readCursor(name, session.userId);

    try {
      // Push first. If the pull below then returns the same rows back, the
      // last-write-wins comparison makes re-applying them a no-op.
      const changed = await table.where('updatedAt').above(cursor).toArray();
      if (changed.length > 0) {
        const { error } = await supabase
          .from(name)
          .upsert(
            changed.map((row) =>
              forUpload(row as unknown as Record<string, unknown>, session.userId),
            ),
            // Every table is keyed on (user_id, id). Conflicting on id alone
            // would fail on `profile`, whose id is the literal string
            // 'profile' on every device.
            { onConflict: 'user_id,id' },
          );
        if (error) throw new Error(`${name}: ${error.message}`);
        pushed += changed.length;
      }

      const { data, error } = await supabase
        .from(name)
        .select('*')
        .gt('updatedAt', cursor)
        .order('updatedAt', { ascending: true })
        .limit(1000);
      if (error) throw new Error(`${name}: ${error.message}`);

      let highest = cursor;
      for (const raw of data ?? []) {
        const { user_id: _ignored, ...row } = raw as Record<string, unknown>;
        const record = row as unknown as SyncMeta & { date?: string };
        if (await mergeRow(table, name, record)) pulled++;
        highest = Math.max(highest, record.updatedAt);
      }

      for (const row of changed) highest = Math.max(highest, row.updatedAt);
      writeCursor(name, session.userId, highest);
    } catch (error) {
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : 'Backup failed.',
      };
    }
  }

  return { ok: true, pushed, pulled };
}

/**
 * Kept as the old name so nothing that imported it breaks, but it now checks
 * the setting rather than firing on mount regardless.
 */
export const syncLocalToSupabase = syncNow;

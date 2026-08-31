import type { Table } from 'dexie';
import { uuidv7 } from '../lib/id';
import { db } from './db';
import {
  PROFILE_ID,
  SCHEMA_VERSION,
  makeDefaultProfile,
  type Profile,
  type SyncMeta,
} from './schema';

/**
 * Every write in the app goes through here.
 *
 * The point is that SyncMeta can never be forgotten: there is no code path
 * that puts a row into a table without an id, an updatedAt and a
 * schemaVersion. That discipline is the entire reason the eventual move to a
 * server is an afternoon of work instead of a rewrite.
 */

export type Draft<T extends SyncMeta> = Omit<T, keyof SyncMeta> &
  Partial<Pick<SyncMeta, 'id'>>;

type UpdateChanges<T extends SyncMeta> = Parameters<Table<T, string>['update']>[1];

export function stamp<T extends SyncMeta>(draft: Draft<T>): T {
  return {
    ...draft,
    id: draft.id ?? uuidv7(),
    updatedAt: Date.now(),
    deletedAt: null,
    schemaVersion: SCHEMA_VERSION,
  } as unknown as T;
}

export async function create<T extends SyncMeta>(
  table: Table<T, string>,
  draft: Draft<T>,
): Promise<T> {
  const record = stamp<T>(draft);
  await table.put(record);
  return record;
}

export async function patch<T extends SyncMeta>(
  table: Table<T, string>,
  id: string,
  changes: Partial<Omit<T, keyof SyncMeta>>,
): Promise<void> {
  // Dexie's UpdateSpec cannot be proven equivalent to Partial<T> for a generic
  // T, so this cast is confined to the two places that perform updates.
  await table.update(id, {
    ...changes,
    updatedAt: Date.now(),
  } as UpdateChanges<T>);
}

/**
 * Soft delete. A hard delete cannot be replicated - another device has no way
 * to learn the row is gone, so it would resurrect it on the next sync.
 */
export async function remove<T extends SyncMeta>(
  table: Table<T, string>,
  id: string,
): Promise<void> {
  const now = Date.now();
  // deletedAt and updatedAt are declared on SyncMeta, so this is sound for
  // every T; TypeScript just cannot prove it through the generic.
  await table.update(id, {
    deletedAt: now,
    updatedAt: now,
  } as unknown as UpdateChanges<T>);
}

export const isLive = <T extends SyncMeta>(record: T): boolean =>
  record.deletedAt === null;

export const liveOnly = <T extends SyncMeta>(records: T[]): T[] =>
  records.filter(isLive);

/* ---------------------------- profile helpers ---------------------------- */

export async function getProfile(): Promise<Profile | undefined> {
  return db.profile.get(PROFILE_ID);
}

/** Returns the existing profile, creating a default one on first run. */
export async function ensureProfile(): Promise<Profile> {
  const existing = await getProfile();
  if (existing) return existing;
  return create(db.profile, { ...makeDefaultProfile(), id: PROFILE_ID });
}

export async function updateProfile(
  changes: Partial<Omit<Profile, keyof SyncMeta>>,
): Promise<void> {
  await ensureProfile();
  await patch(db.profile, PROFILE_ID, changes);
}

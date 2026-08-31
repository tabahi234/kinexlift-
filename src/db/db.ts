import Dexie, { type Table } from 'dexie';
import { APP_SLUG } from '../config';
import type { Checkin, CycleEvent, Profile, SetLog, Session } from './schema';

export class AppDatabase extends Dexie {
  profile!: Table<Profile, string>;
  sessions!: Table<Session, string>;
  sets!: Table<SetLog, string>;
  checkins!: Table<Checkin, string>;
  cycleEvents!: Table<CycleEvent, string>;

  constructor(name: string = APP_SLUG) {
    super(name);

    this.version(1).stores({
      profile: 'id, updatedAt',
      sessions: 'id, startedAt, updatedAt, deletedAt',
      // The compound index is what makes "every squat set in the last 8 weeks"
      // a range scan. This is the query localForage's key-value store cannot
      // do, and the progression engine leans on it constantly.
      sets: 'id, sessionId, performedAt, updatedAt, [exerciseId+performedAt]',
      checkins: 'id, &date, updatedAt',
      cycleEvents: 'id, date, kind, updatedAt',
    });
  }
}

export const db = new AppDatabase();

export const TABLE_NAMES = [
  'profile',
  'sessions',
  'sets',
  'checkins',
  'cycleEvents',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

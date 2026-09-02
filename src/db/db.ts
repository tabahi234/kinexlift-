import Dexie, { type Table } from 'dexie';
import { APP_SLUG } from '../config';
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
} from './schema';

export class AppDatabase extends Dexie {
  profile!: Table<Profile, string>;
  sessions!: Table<Session, string>;
  sets!: Table<SetLog, string>;
  checkins!: Table<Checkin, string>;
  cycleEvents!: Table<CycleEvent, string>;
  conditioning!: Table<ConditioningLog, string>;
  bodyMetrics!: Table<BodyMetric, string>;
  meals!: Table<MealLog, string>;
  chat!: Table<ChatMessage, string>;
  coachNotes!: Table<CoachNote, string>;

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

    // v2: hybrid conditioning, body metrics, nutrition and the coach.
    // Dexie carries the v1 stores forward untouched, so nothing already on a
    // user's phone is rewritten or re-indexed by this upgrade.
    this.version(2).stores({
      conditioning: 'id, date, updatedAt',
      bodyMetrics: 'id, &date, updatedAt',
      // Every read is "what did she eat on this day", so date leads.
      meals: 'id, date, updatedAt, [date+slot]',
      chat: 'id, createdAt, updatedAt',
      coachNotes: 'id, kind, createdAt, updatedAt',
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
  'conditioning',
  'bodyMetrics',
  'meals',
  'chat',
  'coachNotes',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

/**
 * Tables that hold conversation rather than observations.
 *
 * They are excluded from the export bundle by default: a chat log is the one
 * thing in here she is most likely to want gone, and it is not needed to
 * reconstruct a single number the app displays.
 */
export const CONVERSATION_TABLES: TableName[] = ['chat', 'coachNotes'];

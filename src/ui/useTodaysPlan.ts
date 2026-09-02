import { useLiveQuery } from 'dexie-react-hooks';
import { getTodayState, type TodayState } from '../db/derived';

export type { TodayState };

/**
 * Everything the session screen needs, as one live query.
 *
 * Kept as a single subscription rather than several so the screen can never
 * render a plan built from one snapshot next to sets from another. The query
 * itself lives in db/derived.ts, because the coach needs the same answer and
 * cannot call a hook to get it.
 */
export function useTodaysPlan(): TodayState | undefined {
  return useLiveQuery(() => getTodayState(), []);
}

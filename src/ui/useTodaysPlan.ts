import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getTodayState, type TodayState } from '../db/derived';

export type { TodayState };

/**
 * Fired by anything that changes today's state outside the database - the
 * gate override lives in localStorage, and Dexie cannot see it change.
 */
export const TODAY_CHANGED_EVENT = 'today-changed';

/**
 * Everything the session screen needs, as one live query.
 *
 * Kept as a single subscription rather than several so the screen can never
 * render a plan built from one snapshot next to sets from another. The query
 * itself lives in db/derived.ts, because the coach needs the same answer and
 * cannot call a hook to get it.
 *
 * The gate is time-based, so the query also re-runs once a minute: a
 * countdown that reaches zero should turn into a Start button on its own.
 */
export function useTodaysPlan(): TodayState | undefined {
  const tick = useTodayTick();
  return useLiveQuery(() => getTodayState(), [tick]);
}

/**
 * A counter that moves once a minute and whenever TODAY_CHANGED_EVENT fires.
 * Any live query that reads the gate depends on it.
 */
export function useTodayTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    window.addEventListener(TODAY_CHANGED_EVENT, bump);
    const timer = window.setInterval(bump, 60_000);
    return () => {
      window.removeEventListener(TODAY_CHANGED_EVENT, bump);
      window.clearInterval(timer);
    };
  }, []);

  return tick;
}

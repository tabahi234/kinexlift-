import { useLiveQuery } from 'dexie-react-hooks';
import {
  getCheckinFor,
  getExerciseHistory,
  getLastCompletedDayId,
  getOpenSession,
  getOverrideTally,
  getSetsForSession,
} from '../db/queries';
import { getProfile } from '../db/repo';
import { buildSession, exerciseIdsForDay, type PlannedSession } from '../domain/plan';
import { nextDay, programFor } from '../domain/templates';
import {
  adjustmentsEnabled,
  readinessFromCheckin,
  shouldOfferToStopAdjusting,
  type Readiness,
} from '../domain/readiness';
import type { SessionHistory } from '../domain/progression';
import type { Checkin, Session, SetLog, Profile } from '../db/schema';

export interface TodayState {
  profile: Profile | null;
  plan: PlannedSession | null;
  openSession: Session | null;
  loggedSets: SetLog[];
  checkin: Checkin | null;
  readiness: Readiness | null;
  /** She keeps overriding the suggestion, so offer to stop making it. */
  offerToStopAdjusting: boolean;
}

/**
 * Everything the session screen needs, as one live query.
 *
 * Kept as a single subscription rather than several so the screen can never
 * render a plan built from one snapshot next to sets from another.
 */
export function useTodaysPlan(): TodayState | undefined {
  return useLiveQuery(async () => {
    const profile = await getProfile();
    if (!profile || profile.onboardedAt === null) {
      return {
        profile: profile ?? null,
        plan: null,
        openSession: null,
        loggedSets: [],
        checkin: null,
        readiness: null,
        offerToStopAdjusting: false,
      };
    }

    const openSession = (await getOpenSession()) ?? null;
    const lastCompletedDayId = await getLastCompletedDayId();
    const program = programFor(profile.daysPerWeek);

    // Once a session is underway it stays on its own day, even if finishing
    // another session elsewhere would otherwise advance the rotation.
    const day =
      (openSession?.templateId
        ? program.days.find((entry) => entry.id === openSession.templateId)
        : undefined) ?? nextDay(program, lastCompletedDayId);

    const history = new Map<string, SessionHistory>();
    for (const exerciseId of exerciseIdsForDay(day, profile)) {
      history.set(exerciseId, await getExerciseHistory(exerciseId, 6, openSession?.id));
    }

    const checkin = (await getCheckinFor()) ?? null;
    const readiness = readinessFromCheckin(checkin);

    // An override already made this session must stick: without this the plan
    // would snap back to the reduced weight on the next live-query refresh.
    const effectiveReadiness = openSession?.readinessOverride ? null : readiness;

    return {
      profile,
      plan: buildSession(day, program, profile, history, effectiveReadiness),
      openSession,
      loggedSets: openSession ? await getSetsForSession(openSession.id) : [],
      checkin,
      readiness,
      offerToStopAdjusting:
        adjustmentsEnabled(profile) &&
        shouldOfferToStopAdjusting(await getOverrideTally()),
    };
  }, []);
}

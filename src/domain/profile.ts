import type {
  ActivityLevel,
  DietPattern,
  Profile,
  TrainingStyle,
  WeightGoal,
} from '../db/schema';
import { cuisineForCountry, type Cuisine } from './cuisines';

/**
 * One place decides what every v2 setting means.
 *
 * A profile written before a field existed has no value for it, and the whole
 * app has to read that absence the same way or the screen will claim one thing
 * while the engine does another. `adjustmentsEnabled` in readiness.ts was the
 * first of these; everything added in v2 lives here.
 *
 * Pure by design - these take a plain object, not a database row, so the
 * planner and the tests can call them without a Dexie instance.
 */

/** The subset of the profile these resolvers need. */
export type ProfileSettings = Pick<
  Profile,
  | 'trainingStyle'
  | 'activityLevel'
  | 'weightGoal'
  | 'dietPattern'
  | 'foodAvoid'
  | 'country'
  | 'coachOptIn'
  | 'cloudSync'
  | 'trainingDays'
  | 'daysPerWeek'
>;

export function trainingStyleOf(profile: Partial<ProfileSettings>): TrainingStyle {
  return profile.trainingStyle === 'hybrid' ? 'hybrid' : 'strength';
}

export function activityLevelOf(profile: Partial<ProfileSettings>): ActivityLevel {
  return profile.activityLevel ?? 'light';
}

export function weightGoalOf(profile: Partial<ProfileSettings>): WeightGoal {
  return profile.weightGoal ?? 'maintain';
}

export function dietPatternOf(profile: Partial<ProfileSettings>): DietPattern {
  return profile.dietPattern ?? 'omnivore';
}

export function foodAvoidOf(profile: Partial<ProfileSettings>): string[] {
  return profile.foodAvoid ?? [];
}

export function countryOf(profile: Partial<ProfileSettings>): string | null {
  return profile.country ?? null;
}

/**
 * Which region's food she is shown first, or null when she has not said.
 *
 * Null is deliberately not defaulted to anything. Ordering the food list by a
 * region she has nothing to do with is worse than not ordering it at all: an
 * arbitrary list only looks arbitrary, but a confidently wrong one looks
 * broken. Every caller handles null by leaving the table in its own order.
 */
export function cuisineOf(profile: Partial<ProfileSettings>): Cuisine | null {
  return cuisineForCountry(profile.country);
}

/**
 * Both of these gate a network request, so absence has to read as "no".
 * Defaulting either to true would break a promise the onboarding screen made
 * in writing before the feature existed.
 */
export function coachEnabled(profile: Partial<ProfileSettings>): boolean {
  return profile.coachOptIn === true;
}

export function cloudSyncEnabled(profile: Partial<ProfileSettings>): boolean {
  return profile.cloudSync === true;
}

/** Age in whole years, or null when she did not give a birth year. */
export function ageFrom(birthYear: number | null, now: Date = new Date()): number | null {
  if (birthYear === null || !Number.isFinite(birthYear)) return null;
  const age = now.getFullYear() - birthYear;
  return age >= 12 && age <= 110 ? age : null;
}

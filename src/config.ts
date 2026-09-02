/**
 * Single source of truth for app identity.
 * Change the name here and it updates the manifest, the install prompt, the
 * export filename and the UI in one edit.
 */
export const APP_NAME = 'Kinex Lift';
export const APP_SHORT_NAME = 'Kinex Lift';
export const APP_DESCRIPTION =
  'Private, offline-first strength training. Your data stays on your device.';

/** Olive from the original prototype palette. */
export const THEME_COLOR = '#8B9D5C';
export const BACKGROUND_COLOR = '#F4F1E9';

/**
 * Slug used for the IndexedDB database and export filenames.
 *
 * Deliberately still the old spelling. Dexie opens a database *by name*, so
 * renaming this points the app at a new, empty one and every set, weigh-in and
 * period she has logged disappears from her phone with no way back. A product
 * rename is not worth a data loss bug, and the string is never shown to her.
 */
export const APP_SLUG = 'kinexlift';

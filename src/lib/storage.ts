/**
 * Browsers evict IndexedDB under storage pressure, and "clear site data" wipes
 * it outright. For an app whose whole promise is that her training history
 * lives on her device, that is the single biggest data-loss risk - so ask for
 * persistent storage, and surface the answer honestly in the UI.
 */

export type PersistenceState = 'persisted' | 'best-effort' | 'unsupported';

export async function getPersistenceState(): Promise<PersistenceState> {
  if (!navigator.storage?.persisted) return 'unsupported';
  return (await navigator.storage.persisted()) ? 'persisted' : 'best-effort';
}

/**
 * Chrome grants this silently once the app is installed or sufficiently
 * engaged; Firefox prompts; Safari ignores it. Never treat it as guaranteed -
 * exports remain the real backup.
 */
export async function requestPersistence(): Promise<PersistenceState> {
  if (!navigator.storage?.persist) return 'unsupported';
  if (await navigator.storage.persisted()) return 'persisted';
  return (await navigator.storage.persist()) ? 'persisted' : 'best-effort';
}

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return {
    usageBytes: estimate.usage ?? 0,
    quotaBytes: estimate.quota ?? 0,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/* --------------------------- transient choices --------------------------- */

/**
 * "Not today, thanks."
 *
 * The daily check-in gates the session screen, which is right the first time
 * she opens the app in the morning and wrong every time after: declining it
 * and then tapping Fuel and back used to put the same three questions in front
 * of her again, with no way past them except answering.
 *
 * Stored against the date so it expires by itself at midnight, and in
 * localStorage rather than the database because it is a decision about one
 * screen on one device, not an observation worth syncing or exporting.
 * Every access is guarded: private browsing throws on both read and write.
 */
const CHECKIN_SKIP_KEY = 'checkin-skipped';

export function checkinSkippedOn(date: string): boolean {
  try {
    return localStorage.getItem(CHECKIN_SKIP_KEY) === date;
  } catch {
    return false;
  }
}

export function skipCheckinOn(date: string): void {
  try {
    localStorage.setItem(CHECKIN_SKIP_KEY, date);
  } catch {
    // A browser that will not store this is a browser where the prompt comes
    // back on the next visit. Annoying, never broken.
  }
}

/**
 * "I know. Train anyway."
 *
 * The eight-hour pause after a session, and the rest day, both have a small
 * override for the person whose week genuinely does not fit - a two-a-day, a
 * shift that moved. Same shape as the check-in skip: one date, one device,
 * expires by itself, never synced.
 */
const GATE_OVERRIDE_KEY = 'session-gate-override';

export function gateOverriddenOn(date: string): boolean {
  try {
    return localStorage.getItem(GATE_OVERRIDE_KEY) === date;
  } catch {
    return false;
  }
}

export function overrideGateOn(date: string): void {
  try {
    localStorage.setItem(GATE_OVERRIDE_KEY, date);
  } catch {
    // Falls back to the gate. She can tap it again.
  }
}

/** The welcome-back note, dismissed for today. */
const GAP_NOTE_KEY = 'gap-note-dismissed';

export function gapNoteDismissedOn(date: string): boolean {
  try {
    return localStorage.getItem(GAP_NOTE_KEY) === date;
  } catch {
    return false;
  }
}

export function dismissGapNoteOn(date: string): void {
  try {
    localStorage.setItem(GAP_NOTE_KEY, date);
  } catch {
    // Comes back tomorrow at worst.
  }
}

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

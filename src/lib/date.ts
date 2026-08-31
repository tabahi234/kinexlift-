/** 'YYYY-MM-DD' in the user's own timezone. */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Whole days between two date keys.
 * Parsed as UTC noon so daylight-saving transitions cannot shift the result
 * by a day - a real bug in cycle-length maths.
 */
export function daysBetween(fromKey: string, toKey: string): number {
  const parse = (k: string) => Date.parse(`${k}T12:00:00Z`);
  return Math.round((parse(toKey) - parse(fromKey)) / 86_400_000);
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

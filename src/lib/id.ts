/**
 * UUID v7: a 48-bit millisecond timestamp, a monotonic counter, then
 * randomness.
 *
 * Chosen over v4 because ids sort chronologically. That keeps a server-side
 * Postgres primary key index-friendly after the migration, and makes "the most
 * recent sets" an id range scan rather than a sort.
 *
 * The counter is RFC 9562's monotonic method: plain v7 only orders across
 * millisecond boundaries, so a burst of writes inside one tick would come back
 * shuffled. Occupying the 12 rand_a bits with a counter makes ordering hold
 * within a millisecond too.
 */

let lastMs = 0;
let counter = 0;

function nextTick(): { ms: number; seq: number } {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else {
    // Same millisecond, or the system clock stepped backwards. Either way,
    // keep issuing after the last id so ordering never regresses.
    counter++;
    if (counter > 0xfff) {
      lastMs++;
      counter = 0;
    }
  }
  return { ms: lastMs, seq: counter };
}

export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const { ms, seq } = nextTick();
  const timestamp = BigInt(ms);

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = 0x70 | ((seq >> 8) & 0x0f); // version 7 + counter high nibble
  bytes[7] = seq & 0xff; // counter low byte
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

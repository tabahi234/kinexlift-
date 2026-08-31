/**
 * Generates the PWA icon set with no image dependencies.
 *
 * Draws at 4x and box-downsamples for antialiasing, then writes real PNGs
 * via a minimal encoder (zlib is built into Node). Re-run with:
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const OLIVE = [0x8b, 0x9d, 0x5c];
const CREAM = [0xf4, 0xf1, 0xe9];

/* ---------- minimal PNG encoder ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- drawing ---------- */

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Three ascending bars: the app is about progressive overload, so the mark
 * is a load going up over time rather than a generic dumbbell.
 */
function draw(size, { contentScale = 1, bgRadius = 0.22 } = {}) {
  const SS = 4;
  const S = size * SS;
  const hi = new Uint8ClampedArray(S * S * 4);

  const put = (i, [r, g, b]) => {
    hi[i] = r; hi[i + 1] = g; hi[i + 2] = b; hi[i + 3] = 255;
  };

  const bars = [
    { x: 0.255, h: 0.20 },
    { x: 0.435, h: 0.31 },
    { x: 0.615, h: 0.42 },
  ];
  const barW = 0.13;
  const baseline = 0.735;
  const c = (v) => 0.5 + (v - 0.5) * contentScale;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (!inRoundRect(x, y, 0, 0, S, S, bgRadius * S)) continue;
      put(i, OLIVE);

      for (const b of bars) {
        const bx = c(b.x) * S;
        const bw = barW * contentScale * S;
        const bh = b.h * contentScale * S;
        const by = c(baseline) * S - bh;
        if (inRoundRect(x, y, bx, by, bw, bh, bw * 0.32)) put(i, CREAM);
      }

      // baseline rule under the bars
      const rx = c(0.235) * S;
      const rw = 0.53 * contentScale * S;
      const ry = c(baseline) * S + 0.025 * contentScale * S;
      const rh = 0.045 * contentScale * S;
      if (inRoundRect(x, y, rx, ry, rw, rh, rh / 2)) put(i, CREAM);
    }
  }

  // box downsample SSxSS -> 1
  const out = new Uint8ClampedArray(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += hi[i]; g += hi[i + 1]; b += hi[i + 2]; a += hi[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  // Maskable icons get cropped to a circle by the launcher, so the content
  // sits inside the 80% safe zone and the background runs full-bleed.
  ['icon-maskable-512.png', 512, { contentScale: 0.66, bgRadius: 0 }],
  ['apple-touch-icon.png', 180, {}],
  ['favicon.png', 64, {}],
];

for (const [name, size, opts] of targets) {
  writeFileSync(resolve(OUT, name), encodePNG(size, draw(size, opts)));
  console.log(`  ${name}  ${size}x${size}`);
}
console.log('icons written to public/icons/');

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

// Draws the app icon (a card with a barcode) as PNGs, with no image library.
// iOS needs a PNG apple-touch-icon; it rounds the corners itself.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const BG = [15, 118, 110];
const CARD = [255, 255, 255];
const INK = [17, 24, 39];
const BARS = [3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 1, 3, 2, 1, 1, 2, 3, 1, 1, 2];

function inRoundRect(x, y, l, t, r, b, rad) {
  if (x < l || x > r || y < t || y > b) return false;
  const cx = Math.min(Math.max(x, l + rad), r - rad);
  const cy = Math.min(Math.max(y, t + rad), b - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2;
}

// Colour at a point in the unit square; `pad` shrinks the art for maskable icons.
function colorAt(x, y, pad) {
  const s = 1 - 2 * pad;
  const u = (x - pad) / s;
  const v = (y - pad) / s;
  if (!inRoundRect(u, v, 0.14, 0.26, 0.86, 0.74, 0.06)) return BG;
  if (inRoundRect(u, v, 0.21, 0.33, 0.42, 0.42, 0.02)) return BG;
  const total = BARS.reduce((a, b) => a + b, 0);
  if (v > 0.5 && v < 0.67 && u > 0.21 && u < 0.79) {
    let pos = ((u - 0.21) / 0.58) * total;
    for (let i = 0; i < BARS.length; i++) {
      if (pos < BARS[i]) return i % 2 === 0 ? INK : CARD;
      pos -= BARS[i];
    }
  }
  return CARD;
}

function render(size, pad) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, pad);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(acc[k] / (SS * SS));
    }
  }
  return png(size, raw);
}

function png(size, raw) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

for (const [name, size, pad] of [
  ['apple-touch-icon.png', 180, 0],
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.1],
]) {
  writeFileSync(join(out, name), render(size, pad));
}
console.log('icons written to public/icons');

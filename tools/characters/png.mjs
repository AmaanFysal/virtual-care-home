// Writes an 8-bit RGBA PNG (no filter) with node:zlib, for the hand-drawn overlays (zimmer.mjs, stick.mjs).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

/** `px` is W × H RGBA bytes; `url` a file URL. */
export function writePng(url, px, W, H) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  const path = fileURLToPath(url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

/** A dark outline around every drawn pixel of each 64 × 64 frame, as LPC art has. */
export function outline(px, W, frames, colour) {
  const get = (fx, x, y) => px[((y * W) + fx * 64 + x) * 4 + 3];
  for (let fx = 0; fx < frames; fx++) {
    const drawn = [];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (get(fx, x, y)) drawn.push([x, y]);
    for (const [x, y] of drawn) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < 64 && ny >= 0 && ny < 64 && !get(fx, nx, ny)) px.set(colour, ((ny * W) + fx * 64 + nx) * 4);
    }
  }
}

// Draws Peggy's zimmer frame as a small LPC-style overlay: one 64x64 frame per direction, in the
// LPC order north, west, south, east. The LPC generator has no walking frames, so this is drawn here.
// It's drawn over her sprite, except facing north (away from us), where the frame is on the far side
// and is drawn under her (data/sprites.json "overlays.zimmer").
//
//   node tools/characters/zimmer.mjs   ->  apps/web/public/sprites/overlays/zimmer.png
//
// No dependencies: pixels are set by hand and written as a PNG with node:zlib (png.mjs). Original art
// for this project, released under CC0.

import { outline, writePng } from "./png.mjs";

const W = 64 * 4;
const H = 64;
const px = new Uint8Array(W * H * 4);

const METAL = [168, 176, 186, 255];
const LIGHT = [226, 231, 237, 255];
const FAR = [128, 134, 144, 255]; // the far-side legs, a little darker
const GRIP = [62, 64, 72, 255];
const FOOT = [34, 34, 38, 255];
const OUTLINE = [40, 44, 52, 255];

function set(fx, x, y, c) {
  if (x < 0 || x > 63 || y < 0 || y > 63) return;
  px.set(c, ((y * W) + fx * 64 + x) * 4);
}
const vline = (fx, x, y0, y1, c) => { for (let y = y0; y <= y1; y++) set(fx, x, y, c); };
const hline = (fx, x0, x1, y, c) => { for (let x = x0; x <= x1; x++) set(fx, x, y, c); };

/** A leg: 2 px of tube, lit on the left, with a rubber foot. */
function leg(fx, x, top, bottom, far = false) {
  vline(fx, x, top, bottom - 1, far ? FAR : LIGHT);
  vline(fx, x + 1, top, bottom - 1, far ? FAR : METAL);
  set(fx, x, bottom, FOOT);
  set(fx, x + 1, bottom, FOOT);
}
function rail(fx, x0, x1, y, far = false) {
  hline(fx, x0, x1, y, far ? FAR : LIGHT);
  hline(fx, x0, x1, y + 1, far ? FAR : METAL);
}

// North (index 0): facing away, the frame is beyond her, so higher on screen and drawn under her.
leg(0, 15, 41, 57, true);
leg(0, 47, 41, 57, true);
rail(0, 15, 48, 41, true);
leg(0, 17, 45, 60);
leg(0, 45, 45, 60);
rail(0, 15, 48, 49, true);

// West (index 1): side view, the frame in front of her (to the left).
leg(1, 9, 45, 62, true); // far-side legs, one pixel up and right
leg(1, 21, 45, 61, true);
leg(1, 8, 46, 63);
leg(1, 20, 46, 62);
rail(1, 8, 23, 45);
set(1, 21, 45, GRIP);
set(1, 22, 45, GRIP);
set(1, 23, 45, GRIP);
rail(1, 8, 21, 54);

// South (index 2): facing us, the frame in front of her, around her body; the front legs are
// nearer, so they reach lower down the screen.
leg(2, 17, 45, 60, true); // back legs, by her feet
leg(2, 45, 45, 60, true);
leg(2, 14, 48, 63);
leg(2, 48, 48, 63);
for (const [x0, x1] of [[14, 18], [45, 49]]) { // side rails running back to the hand grips
  hline(2, x0, x1, 46, LIGHT);
  hline(2, x0, x1, 47, METAL);
}
for (const x of [17, 18, 45, 46]) set(2, x, 45, GRIP);
rail(2, 14, 49, 55); // front crossbar

// East (index 3): the mirror of west.
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  const i = ((y * W) + 64 + x) * 4;
  px.set(px.subarray(i, i + 4), ((y * W) + 3 * 64 + (63 - x)) * 4);
}

outline(px, W, 4, OUTLINE);
writePng(new URL("../../apps/web/public/sprites/overlays/zimmer.png", import.meta.url), px, W, H);
console.log("wrote apps/web/public/sprites/overlays/zimmer.png");

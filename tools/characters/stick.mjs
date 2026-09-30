// Draws a walking stick as a small LPC-style overlay: one 64x64 frame per direction, in the LPC
// order north, west, south, east, held in the right hand and drawn over the walk and stand frames
// of anyone whose card says they use one (data/sprites.json "overlays.stick"; Win and Kamala).
// The LPC generator has no walking stick.
//
//   node tools/characters/stick.mjs   ->  apps/web/public/sprites/overlays/stick.png
//
// No dependencies: pixels are set by hand (png.mjs). Original art for this project, released under CC0.

import { outline, writePng } from "./png.mjs";

const W = 64 * 4;
const H = 64;
const px = new Uint8Array(W * H * 4);

const WOOD = [112, 72, 40, 255];
const LIGHT = [164, 114, 68, 255];
const TIP = [34, 34, 38, 255];
const OUTLINE = [40, 30, 24, 255];

function set(fx, x, y, c) {
  if (x < 0 || x > 63 || y < 0 || y > 63) return;
  px.set(c, ((y * W) + fx * 64 + x) * 4);
}

/**
 * A stick from the hand (x, top) to the floor (bottom), leaning `lean` pixels over its length,
 * with a crook handle over the hand bending towards `hook` (-1 left, 1 right) and a rubber tip.
 */
function stick(fx, x, top, bottom, lean, hook) {
  for (let y = top; y < bottom; y++) {
    const sx = x + Math.round((lean * (y - top)) / (bottom - top));
    set(fx, sx, y, LIGHT);
    set(fx, sx + 1, y, WOOD);
  }
  // The crook: up one pixel and over two, then down one.
  set(fx, x, top - 1, LIGHT);
  set(fx, x + 1, top - 1, WOOD);
  set(fx, x + hook * 2, top - 1, WOOD);
  set(fx, x + hook * 2 + (hook > 0 ? 1 : 0), top - 1, WOOD);
  set(fx, x + hook * 2 + (hook > 0 ? 1 : 0), top, WOOD);
  const tipX = x + lean;
  set(fx, tipX, bottom, TIP);
  set(fx, tipX + 1, bottom, TIP);
}

// North (index 0): facing away; her right hand is on our right.
stick(0, 43, 45, 60, 1, 1);
// West (index 1): side view, the near (right) hand towards her back; the tip a little forward.
stick(1, 38, 46, 61, -2, -1);
// South (index 2): facing us; her right hand is on our left.
stick(2, 19, 45, 61, -1, -1);
// East (index 3): the mirror of west.
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  const i = ((y * W) + 64 + x) * 4;
  px.set(px.subarray(i, i + 4), ((y * W) + 3 * 64 + (63 - x)) * 4);
}

outline(px, W, 4, OUTLINE);
writePng(new URL("../../apps/web/public/sprites/overlays/stick.png", import.meta.url), px, W, H);
console.log("wrote apps/web/public/sprites/overlays/stick.png");

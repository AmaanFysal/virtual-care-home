// Draws the small props LPC doesn't have, as LPC-style pixel art (see tools/tiles/README.md):
//
//   node tools/tiles/props.mjs  ->  apps/web/public/tiles/props/{tv,books,icons}.png
//
//   tv.png        a flat-screen TV on the Lounge's TV cabinet (the LPC cabinet comes from the wooden
//                 furniture pack), turned a little towards us so the lit screen shows. 24x48 frames:
//                 0 faces west, 1 faces east.
//   books.png     book tops laid over the side-view LPC cupboard that serves as the Lounge bookshelf.
//   icons.png     the name-tag activity icons, 12x12 each, in the order of ICONS below.
//   pictures.png  three framed pictures for the wall faces, 18x14 each.
//   plants.png    two potted plants, 20x30 each.
//   lamp.png      a bedside lamp, 10x14.
//
// No dependencies: pixels are set by hand and written as PNGs with node:zlib. Original art for this
// project, released under CC0. Colours are sampled from the LPC packs so the props sit in with them.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUTLINE = [40, 36, 48, 255];
const PALETTE = {
  k: OUTLINE,
  w: [242, 241, 234, 255],
  g: [186, 190, 198, 255],
  s: [120, 126, 138, 255], // steel grey
  d: [58, 60, 70, 255], // screen bezel
  n: [30, 32, 40, 255], // screen black
  e: [96, 132, 196, 255], // screen glint
  r: [214, 64, 60, 255],
  o: [228, 146, 60, 255],
  c: [160, 104, 60, 255], // tea, wood
  G: [78, 160, 92, 255],
  b: [84, 128, 214, 255],
  p: [236, 122, 152, 255],
  y: [236, 200, 84, 255],
  l: [156, 138, 206, 255],
  t: [70, 120, 110, 255], // teal cloth
  S: [138, 186, 236, 255], // screen sky
  L: [196, 226, 250, 255], // screen glint
  M: [96, 164, 104, 255], // screen hills
  F: [132, 88, 52, 255], // picture frame
  f: [196, 150, 84, 255], // frame highlight
  T: [186, 98, 62, 255], // terracotta
  D: [44, 112, 64, 255], // dark leaf
  C: [236, 222, 176, 255], // lamp shade
};

function image(w, h) {
  const px = new Uint8Array(w * h * 4);
  return {
    w,
    h,
    px,
    set(x, y, c) {
      if (x >= 0 && x < w && y >= 0 && y < h) px.set(c, (y * w + x) * 4);
    },
    alpha: (x, y) => (x >= 0 && x < w && y >= 0 && y < h ? px[(y * w + x) * 4 + 3] : 0),
  };
}

/** Paints ASCII art ('.' is transparent) with its top-left at (x0, y0). */
function paint(img, x0, y0, rows) {
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && img.set(x0 + x, y0 + y, PALETTE[ch])));
}

/** A dark outline around everything drawn inside the box, as LPC art has. */
function outline(img, x0, y0, w, h) {
  const drawn = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (img.alpha(x, y) === 255) drawn.push([x, y]);
  for (const [x, y] of drawn)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= x0 && nx < x0 + w && ny >= y0 && ny < y0 + h && img.alpha(nx, ny) < 255) img.set(nx, ny, OUTLINE);
    }
}

function png(img) {
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
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) Buffer.from(img.px.buffer, y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- TV (2 frames of 24x48)
// Turned a little towards us: the lit screen is a slanted panel (its far end higher up), with its
// thin back edge behind it, a stand, and a soft glow spilling from the screen.
const tv = image(48, 48);
function drawTv(fx) {
  const at = (x, y, c) => tv.set(fx * 24 + x, y, c);
  const top = (x) => Math.round(12 - ((x - 5) * 7) / 11);
  const bottom = (x) => Math.round(34 - ((x - 5) * 8) / 11);
  // Glow first, fading away from the screen.
  for (let x = 0; x < 5; x++) for (let y = top(5) - 2 + x; y <= bottom(5) + 2 - x; y++) at(x, y, [170, 215, 255, 36 + x * 14]);
  for (let x = 5; x <= 16; x++) {
    const t = top(x), b = bottom(x);
    for (let y = t; y <= b; y++) {
      const edge = x === 5 || x === 16 || y === t || y === b;
      const k = (y - t) / (b - t);
      at(x, y, edge ? PALETTE.n : k < 0.55 ? PALETTE.S : PALETTE.M);
    }
    if (x < 16) at(x + 1, t - 1, PALETTE.d); // the thin top edge
  }
  for (let x = 7; x <= 11; x++) at(x, top(x) + 2 + (x - 7), PALETTE.L); // glint
  for (let y = top(16); y <= bottom(16); y++) at(17, y, PALETTE.d); // back edge
  for (let y = bottom(11); y < 40; y++) at(11, y, PALETTE.s); // stand
  for (let x = 8; x <= 14; x++) at(x, 40, PALETTE.s);
  for (let x = 9; x <= 13; x++) at(x, 41, PALETTE.d);
}
drawTv(0);
outline(tv, 0, 0, 24, 48);
// Frame 1: the mirror of frame 0 (facing east).
for (let y = 0; y < 48; y++) for (let x = 0; x < 24; x++) {
  const i = (y * 48 + x) * 4;
  tv.px.set(tv.px.subarray(i, i + 4), (y * 48 + 24 + (23 - x)) * 4);
}

// ---------------------------------------------------------------- book tops (16x48)
// Rows of book tops along the cupboard's top, in muted cloth colours.
const books = image(16, 48);
const SPINES = ["r", "t", "y", "b", "c", "G", "l", "o", "t", "r", "b", "y", "c", "l"];
let y = 3;
for (let i = 0; y < 44; i++) {
  const c = PALETTE[SPINES[i % SPINES.length]];
  const thick = 2 + (i % 3 === 0 ? 1 : 0);
  const len = 10 + (i % 2);
  for (let dy = 0; dy < thick; dy++) for (let x = 3; x < 3 + len; x++) books.set(x, y + dy, c);
  for (let x = 3; x < 3 + len; x++) books.set(x, y + thick, OUTLINE);
  y += thick + 1;
}

// ---------------------------------------------------------------- icons (12x12 each)
const ICONS = {
  meal: [
    "..........",
    "..wwwwww..",
    ".wwwwwwww.",
    "wwwoGGcwww",
    "wwoooGccww",
    "wwwoocccww",
    "gwwwwwwwwg",
    ".gwwwwwwg.",
    "..gggggg..",
    "..........",
  ],
  drink: [
    ".g..g.....",
    "..g..g....",
    ".g..g.....",
    "wwwwwww...",
    "wcccccwww.",
    "wwwwwww.w.",
    "wwwwwww.w.",
    "wwwwwwwww.",
    ".wwwww....",
    "..........",
  ],
  meds: [
    "......rrr.",
    ".....rrrrr",
    "....rrrrrr",
    "...wrrrrr.",
    "..wwwrrr..",
    ".wwwwwr...",
    "wwwwww....",
    "wwwwww....",
    ".wwww.....",
    "..........",
  ],
  care: [
    "..........",
    ".pp...pp..",
    "pppp.pppp.",
    "pwpppppp.p",
    "ppppppppp.",
    ".ppppppp..",
    "..ppppp...",
    "...ppp....",
    "....p.....",
    "..........",
  ],
  asleep: [
    "bbbbbb....",
    "....bb....",
    "...bb.....",
    "..bb......",
    ".bb..bbbb.",
    "bbbbbb.bb.",
    "......bb..",
    ".....bb...",
    ".....bbbb.",
    "..........",
  ],
  notes: [
    "...gggg...",
    ".ccggggcc.",
    ".cwwwwwwc.",
    ".cwsssswc.",
    ".cwwwwwwc.",
    ".cwsssswc.",
    ".cwwwwwwc.",
    ".cwssswwc.",
    ".cwwwwwwc.",
    ".cccccccc.",
  ],
  chatting: [
    "..........",
    ".wwwwwwww.",
    "wwwwwwwwww",
    "wwswwswwsw",
    "wwwwwwwwww",
    ".wwwwwwww.",
    "..ww......",
    "..w.......",
    "..........",
    "..........",
  ],
  visiting: [
    "..p.p.p...",
    "..ppppp...",
    "..ppppp...",
    "...ppp....",
    "....G.....",
    ".GG.G.....",
    "..GGG.GG..",
    "....GGG...",
    "....G.....",
    "..........",
  ],
  break: [
    "...GGGG...",
    ".GGGGGGGG.",
    ".GGwGGwGG.",
    "GGGwGGwGGG",
    "GGGwGGwGGG",
    "GGGwGGwGGG",
    ".GGwGGwGG.",
    ".GGGGGGGG.",
    "...GGGG...",
    "..........",
  ],
  fall: [
    "....rr....",
    "....rr....",
    "...rwwr...",
    "...rwwr...",
    "..rrwwrr..",
    "..rrwwrr..",
    ".rrrrrrrr.",
    ".rrrwwrrr.",
    "rrrrrrrrrr",
    "..........",
  ],
};
const names = Object.keys(ICONS);
const icons = image(12 * names.length, 12);
names.forEach((name, i) => {
  paint(icons, i * 12 + 1, 1, ICONS[name]);
  outline(icons, i * 12, 0, 12, 12);
});

// ---------------------------------------------------------------- pictures (3 of 18x14)
const PICTURES = [
  [
    "FFFFFFFFFFFFFFFF",
    "FfSSSSSSSSSSSSfF",
    "FfSSSSwwSSSSSSfF",
    "FfSSSwwwwSSSSSfF",
    "FfSSSSSSSSSyySfF",
    "FfSMMSSSSSSyySfF",
    "FfMMMMSSSMMSSSfF",
    "FfMMMMMMMMMMMMfF",
    "FfGGMMMMMMGGMMfF",
    "FfGGGGGGGGGGGGfF",
    "FfffffffffffffF",
    "FFFFFFFFFFFFFFFF",
  ],
  [
    "FFFFFFFFFFFFFFFF",
    "FfwwwwwwwwwwwwfF",
    "Ffwwwpwrwpwwwwff",
    "FfwwprprprpwwwfF",
    "FfwwwpGpGpwwwwfF",
    "FfwwwwGGGwwwwwfF",
    "FfwwwwwGwwwwwwfF",
    "FfwwwwbbbwwwwwfF",
    "FfwwwwbbbwwwwwfF",
    "FfwwwwwbwwwwwwfF",
    "FfffffffffffffF",
    "FFFFFFFFFFFFFFFF",
  ],
  [
    "FFFFFFFFFFFFFFFF",
    "FfSSSSSSSSSSSSfF",
    "FfSSSSSSSwSSSSfF",
    "FfSSSSSSwwSSSSfF",
    "FfSSSSSwwwSSSSfF",
    "FfSSSSSSkSSSSSfF",
    "FfbbbbbcccbbbbfF",
    "FfbbbbbbbbbbbbfF",
    "FfbbLbbbbbLbbbfF",
    "FfyyyyyyyyyyyyfF",
    "FfffffffffffffF",
    "FFFFFFFFFFFFFFFF",
  ],
];
const pictures = image(18 * PICTURES.length, 14);
PICTURES.forEach((rows, i) => {
  paint(pictures, i * 18 + 1, 1, rows.map((r) => r.padEnd(16, "F").slice(0, 16)));
  outline(pictures, i * 18, 0, 18, 14);
});

// ---------------------------------------------------------------- plants (2 of 20x30)
const PLANTS = [
  [
    "......D...GG......",
    "...GG.DG.GGGD.....",
    "..GGGDDGGGDDGG....",
    ".GGDGGDGGDGGDGG...",
    "GGDGGGDGDGGDGDGG..",
    ".GDDGGGDDGGGDDG...",
    "GGGDGDGGGDGDGGGG..",
    ".DGGGDGGGDGGGDG...",
    "..GGDDGGDDGGDD....",
    "...DGGGDGGGD......",
    ".....DGGGD........",
    "......DcD.........",
    "......ccc.........",
    "....TTTTTTTT......",
    "....TTTTTTTT......",
    ".....TTTTTT.......",
    ".....TTTTTT.......",
    "......TTTT........",
  ],
  [
    "..................",
    "..................",
    "..................",
    "..................",
    "...G.....G........",
    "..GDG...GDG.......",
    "...GDG.GDG..G.....",
    ".G..GDGDG..GDG....",
    "GDG..GDG..GDG.....",
    ".GDG.GDG.GDG......",
    "..GDGGDGGDG.......",
    "....GDDDG.........",
    "......c...........",
    "....wwwwwww.......",
    "....wwwwwww.......",
    ".....wwwww........",
    ".....wwwww........",
    "......www.........",
  ],
];
const plants = image(20 * PLANTS.length, 30);
PLANTS.forEach((rows, i) => {
  paint(plants, i * 20 + 1, 30 - rows.length - 1, rows);
  outline(plants, i * 20, 0, 20, 30);
});

// ---------------------------------------------------------------- bedside lamp (10x14)
const lamp = image(10, 14);
paint(lamp, 1, 1, [
  "..CCCC..",
  ".CCCCCC.",
  ".CCCCCC.",
  "CCCCCCCC",
  "...yy...",
  "...yy...",
  "...yy...",
  "...yy...",
  "..yyyy..",
  ".yyyyyy.",
]);
outline(lamp, 0, 0, 10, 14);

const out = new URL("../../apps/web/public/tiles/props/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("tv.png", out), png(tv));
writeFileSync(new URL("books.png", out), png(books));
writeFileSync(new URL("icons.png", out), png(icons));
writeFileSync(new URL("pictures.png", out), png(pictures));
writeFileSync(new URL("plants.png", out), png(plants));
writeFileSync(new URL("lamp.png", out), png(lamp));
console.log(`wrote tv, books, icons (${names.join(", ")}), pictures, plants and lamp PNGs to apps/web/public/tiles/props/`);

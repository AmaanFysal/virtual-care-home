// Paints the wing from data/floorplan.json with the tile art in tileset.json (docs/08
// "Pixel-art map"): one canvas for everything flat (grass, floors, rugs, wall faces, windows,
// pictures, wall tops, doorways, the garden path), and one small canvas per piece of furniture or
// standing decor, which the renderer y-sorts with the people. Nothing is hand-placed: rooms, walls,
// doors and furniture come from the floor plan, and the decor is placed by rules from it.
// Decor is render-only: it never blocks anyone, and the simulation doesn't know it's there.

import type { FloorPlan, Furniture, Room } from "@vch/shared-types";
import { FACE_PX, TILE_PX, TRIM_PX, type Band, type Banding } from "./banding";
import type { Dir } from "./figures";
import tileset from "./tileset.json";

export type Images = Record<keyof typeof tileset.images, CanvasImageSource>;
type Src = { image: string; x: number; y: number; w: number; h: number };
type Slice = { l: number; r: number; t: number; b: number };
type Rect = { x: number; y: number; w: number; h: number };

export interface FurniturePiece {
  id: string;
  canvas: HTMLCanvasElement;
  /** Top-left in world pixels. */
  x: number;
  y: number;
  /** The y-sort key: people with a larger key are drawn over it. */
  z: number;
}

export interface PaintedMap {
  base: HTMLCanvasElement;
  /** The whole picture, building and garden, in world pixels. */
  size: { w: number; h: number };
  furniture: FurniturePiece[];
  /** Bedside lamps, which glow at night (world pixels). */
  lamps: { x: number; y: number }[];
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Copies a source rect, repeating it to fill the destination (no scaling). */
function tile(ctx: CanvasRenderingContext2D, img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  for (let y = 0; y < dh; y += sh)
    for (let x = 0; x < dw; x += sw) {
      const w = Math.min(sw, dw - x);
      const h = Math.min(sh, dh - y);
      ctx.drawImage(img, sx, sy, w, h, dx + x, dy + y, w, h);
    }
}

/** A 9-slice whose edges and middle repeat instead of stretching, so pixels stay square. */
function nine(ctx: CanvasRenderingContext2D, img: CanvasImageSource, src: Src, s: Slice, dx: number, dy: number, dw: number, dh: number): void {
  const l = Math.min(s.l, dw / 2), r = Math.min(s.r, dw / 2), t = Math.min(s.t, dh / 2), b = Math.min(s.b, dh / 2);
  const mw = src.w - s.l - s.r, mh = src.h - s.t - s.b;
  const cols: [number, number, number, number][] = [
    [src.x, l, dx, l],
    [src.x + s.l, mw, dx + l, dw - l - r],
    [src.x + src.w - r, r, dx + dw - r, r],
  ];
  const rows: [number, number, number, number][] = [
    [src.y, t, dy, t],
    [src.y + s.t, mh, dy + t, dh - t - b],
    [src.y + src.h - b, b, dy + dh - b, b],
  ];
  for (const [sx, sw, cx, cw] of cols) for (const [sy, sh, cy, ch] of rows) tile(ctx, img, sx, sy, sw, sh, cx, cy, cw, ch);
}

function pattern(ctx: CanvasRenderingContext2D, images: Images, src: Src, originX: number, originY: number): CanvasPattern {
  const [c, cx] = canvas(src.w, src.h);
  cx.drawImage(images[src.image as keyof Images], src.x, src.y, src.w, src.h, 0, 0, src.w, src.h);
  const p = ctx.createPattern(c, "repeat")!;
  p.setTransform(new DOMMatrix().translate(originX, originY));
  return p;
}

const inRect = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
/** Distance from a point to a rect (0 inside). */
const distToRect = (r: Rect, x: number, y: number) => Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
function bounds(rects: Rect[], margin: number): Rect {
  const x0 = Math.min(...rects.map((r) => r.x)) - margin, y0 = Math.min(...rects.map((r) => r.y)) - margin;
  const x1 = Math.max(...rects.map((r) => r.x + r.w)) + margin, y1 = Math.max(...rects.map((r) => r.y + r.h)) + margin;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function clampTo(r: Rect, room: Rect, inset: number): Rect {
  const x0 = Math.max(r.x, room.x + inset), y0 = Math.max(r.y, room.y + inset);
  const x1 = Math.min(r.x + r.w, room.x + room.w - inset), y1 = Math.min(r.y + r.h, room.y + room.h - inset);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function paintMap(plan: FloorPlan, banding: Banding, images: Images, facings: Map<string, Dir>): PaintedMap {
  const W = banding.size.w;
  const H = Math.ceil(banding.size.h + tileset.garden.margin * TILE_PX);
  const [base, ctx] = canvas(W, H);
  const X = banding.x;
  const img = (k: string) => images[k as keyof Images];
  /** Screen y of a floor-plan y for rigid things: shifted by the bands above, not stretched. */
  const rigid = (m: number, at = m) => m * TILE_PX + banding.offsetAt(at);
  const roomTop = (r: Room) => rigid(r.rect.y);
  const roomBottom = (r: Room) => rigid(r.rect.y + r.rect.h, r.rect.y + r.rect.h - 1e-6);
  const southEdge = (y: number) => rigid(y, y - 1e-6);
  const floors = tileset.floors as unknown as Record<string, Src | undefined>;
  const fill = (src: Src, originY: number, x0: number, y0: number, x1: number, y1: number) => {
    ctx.fillStyle = pattern(ctx, images, src, X(0), originY);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  const fillFloor = (r: Room, x0: number, y0: number, x1: number, y1: number, src = floors[r.kind]) => src && fill(src, roomTop(r), x0, y0, x1, y1);
  /** A floor-plan rect (metres) inside a room, drawn rigidly at the room's offset. */
  const screenRect = (r: Rect) => {
    const at = r.y + r.h / 2;
    const x0 = X(r.x), y0 = rigid(r.y, at);
    return { x: x0, y: y0, w: X(r.x + r.w) - x0, h: rigid(r.y + r.h, at) - y0 };
  };
  const byId = (id: string) => plan.furniture.find((f) => f.id === id);
  const roomOf = (id: string) => plan.rooms.find((r) => r.id === id)!;
  const pieces: FurniturePiece[] = [];
  const lamps: { x: number; y: number }[] = [];
  const piece = (id: string, w: number, h: number, x: number, y: number, z: number, draw: (c: CanvasRenderingContext2D) => void) => {
    const [c, cctx] = canvas(w, h);
    draw(cctx);
    pieces.push({ id, canvas: c, x: Math.round(x), y: Math.round(y), z });
  };
  const sprite = (id: string, s: Src, cx: number, bottomY: number, z = bottomY) =>
    piece(id, s.w, s.h, cx - s.w / 2, bottomY - s.h, z, (c) => c.drawImage(img(s.image), s.x, s.y, s.w, s.h, 0, 0, s.w, s.h));

  // ---------------------------------------------------------------- outside, floors, rugs
  fill(tileset.floors.grass, 0, 0, 0, W, H);
  // Largest first, so a room inside another (an en-suite) is drawn over it.
  for (const r of [...plan.rooms].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)) fillFloor(r, X(r.rect.x), roomTop(r), X(r.rect.x + r.rect.w), roomBottom(r));
  for (const patch of tileset.floorPatches) {
    const parts = patch.around.map(byId).filter((f): f is Furniture => !!f);
    if (parts.length === 0) continue;
    const r = screenRect(clampTo(bounds(parts.map((f) => f.rect), patch.margin), roomOf(parts[0]!.room).rect, 0));
    fill(floors[patch.floor]!, r.y, r.x, r.y, r.x + r.w, r.y + r.h);
  }
  for (const rug of tileset.rugs) {
    const parts = rug.around.map(byId).filter((f): f is Furniture => !!f);
    if (parts.length === 0) continue;
    const r = screenRect(clampTo(bounds(parts.map((f) => f.rect), rug.margin), roomOf(parts[0]!.room).rect, 0.125));
    nine(ctx, img(rug.image), rug, rug.slice, r.x, r.y, r.w, r.h);
  }
  // A small rug at the foot of each bed.
  const beds = plan.furniture.filter((f) => f.kind === "bed");
  const bedRug = tileset.decor.bedRug;
  for (const bed of beds) {
    const [w, h] = bedRug.size;
    const r = screenRect({ x: bed.rect.x + bed.rect.w / 2 - w! / 2, y: bed.rect.y + bed.rect.h, w: w!, h: h! });
    nine(ctx, img(bedRug.image), bedRug, bedRug.slice, r.x, r.y, r.w, r.h);
  }

  // ---------------------------------------------------------------- wall faces
  // Each band shows the inside face of the rooms below it; where the building has no room below,
  // it's the outside wall, seen from the garden.
  const faceH = FACE_PX - TRIM_PX;
  const drawFace = (face: typeof tileset.walls.face, x0: number, x1: number, y: number, h = faceH) => {
    const keepTop = Math.max(0, h - face.keepBottom);
    const keepBottom = Math.min(face.keepBottom, h);
    tile(ctx, img(face.image), face.x, face.y, face.w, keepTop, x0, y, x1 - x0, keepTop);
    tile(ctx, img(face.image), face.x, face.y + face.h - keepBottom, face.w, keepBottom, x0, y + keepTop, x1 - x0, keepBottom);
  };
  const doorsOn = (y: number) => plan.doors.filter((d) => d.y1 === y && d.y2 === y).map((d) => [Math.min(d.x1, d.x2), Math.max(d.x1, d.x2)] as const);
  for (const band of banding.bands) {
    const faceY = band.top + TRIM_PX;
    const below = plan.rooms.filter((r) => r.rect.y === band.y);
    for (const w of plan.walls.filter((w) => w.y1 === band.y && w.y2 === band.y)) {
      const [a, b] = [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)];
      // The outside face first, then the rooms' faces over it.
      drawFace(tileset.walls.exterior, X(a), X(b), faceY);
      for (const r of below) {
        const x0 = Math.max(a, r.rect.x), x1 = Math.min(b, r.rect.x + r.rect.w);
        if (x1 > x0) drawFace(tileset.walls.face, X(x0), X(x1), faceY);
      }
    }
    for (const r of below) (band.blended ? paintPictures : paintWindows)(band, r);
    for (const [a, b] of doorsOn(band.y)) paintDoorway(band, a, b);
  }

  /** Windows on an outer wall: one over each bed, otherwise one per `spacing` metres. */
  function paintWindows(band: Band, room: Room): void {
    const win = tileset.walls.window;
    const w = Math.max(...win.parts.map((p) => p.w)) / TILE_PX;
    const inRoom = beds.filter((b) => b.room === room.id).map((b) => b.rect.x + b.rect.w / 2);
    const n = Math.max(1, Math.floor(room.rect.w / win.spacing));
    const centres = inRoom.length > 0 ? inRoom : Array.from({ length: n }, (_, i) => room.rect.x + (room.rect.w * (i + 0.5)) / n);
    for (const c of centres) {
      const cx = Math.min(Math.max(c, room.rect.x + w / 2 + 0.1), room.rect.x + room.rect.w - w / 2 - 0.1);
      for (const p of win.parts) ctx.drawImage(img(win.image), p.x, p.y, p.w, p.h, Math.round(X(cx) - p.w / 2), band.top + TRIM_PX + p.dy, p.w, p.h);
    }
  }

  /** Framed pictures along an inner wall, clear of doorways and the room's corners. */
  function paintPictures(band: Band, room: Room): void {
    const pic = tileset.walls.pictures;
    const doors = doorsOn(band.y);
    let i = Math.round(room.rect.x);
    for (let x = room.rect.x + pic.spacing / 2; x < room.rect.x + room.rect.w; x += pic.spacing) {
      const clearOfEnds = x - room.rect.x >= pic.clear && room.rect.x + room.rect.w - x >= pic.clear;
      const clearOfDoors = doors.every(([a, b]) => x < a - pic.clear || x > b + pic.clear);
      if (!clearOfEnds || !clearOfDoors) continue;
      const k = i++ % pic.count;
      ctx.drawImage(img(pic.image), k * pic.w, 0, pic.w, pic.h, Math.round(X(x) - pic.w / 2), band.top + TRIM_PX + pic.dy, pic.w, pic.h);
    }
  }

  function paintDoorway(band: Band, a: number, b: number): void {
    const x0 = X(a), x1 = X(b);
    const mid = (a + b) / 2;
    const inRoom = (r: Room) => mid >= r.rect.x && mid <= r.rect.x + r.rect.w;
    const above = plan.rooms.find((r) => r.rect.y + r.rect.h === band.y && inRoom(r));
    const below = plan.rooms.find((r) => r.rect.y === band.y && inRoom(r));
    const half = band.top + FACE_PX / 2;
    if (above) fillFloor(above, x0, band.top, x1, half);
    if (below) fillFloor(below, x0, above ? half : band.top, x1, band.top + FACE_PX);
    ctx.fillStyle = tileset.walls.door.frame;
    ctx.fillRect(x0, band.top, 3, FACE_PX);
    ctx.fillRect(x1 - 3, band.top, 3, FACE_PX);
  }

  // ---------------------------------------------------------------- the garden
  // Outside ground: the part of the plan no room covers, and the strip along the front.
  const cell = 0.5;
  const outsideCells: [number, number][] = [];
  for (let y = 0; y < plan.size.h; y += cell)
    for (let x = 0; x < plan.size.w; x += cell) if (!plan.rooms.some((r) => inRect(r.rect, x + cell / 2, y + cell / 2))) outsideCells.push([x, y]);
  const buildingBottom = southEdge(plan.size.h);
  const front = tileset.walls.exterior.southHeight;
  // The building's front wall, seen from the garden, below the south wall top.
  for (const w of plan.walls.filter((w) => w.y1 === plan.size.h && w.y2 === plan.size.h)) {
    const [a, b] = [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)];
    drawFace(tileset.walls.exterior, X(a), X(b), buildingBottom + TRIM_PX, front);
  }
  const G = tileset.garden;
  const garden = outsideCells.length ? bounds(outsideCells.map(([x, y]) => ({ x, y, w: cell, h: cell })), 0) : null;
  const gardenPx = garden && {
    x: X(garden.x),
    y: rigid(garden.y) + TRIM_PX,
    w: X(garden.x + garden.w) - X(garden.x),
    h: H - rigid(garden.y) - TRIM_PX,
  };
  const exit = plan.doors.find((d) => d.rooms.includes("Outside"));
  if (exit) {
    const pw = G.pathWidth * TILE_PX;
    const ex = X((exit.x1 + exit.x2) / 2);
    const turnY = buildingBottom + TRIM_PX + front + TILE_PX;
    const path = (x0: number, y0: number, x1: number, y1: number) => fill(tileset.floors.path, 0, Math.round(Math.min(x0, x1)), Math.round(Math.min(y0, y1)), Math.round(Math.max(x0, x1)), Math.round(Math.max(y0, y1)));
    // Out of the door, down past the front wall, then along to the garden and up to its bench.
    path(ex - pw / 2, buildingBottom, ex + pw / 2, turnY + pw);
    if (gardenPx) {
      const bx = gardenPx.x + gardenPx.w * G.bench.at[0]!;
      const by = gardenPx.y + gardenPx.h * G.bench.at[1]!;
      path(ex - pw / 2, turnY, bx + pw / 2, turnY + pw);
      path(bx - pw / 2, by + 4, bx + pw / 2, turnY + pw);
    }
  }
  if (gardenPx) {
    for (const [i, t] of G.trees.entries()) sprite(`garden.tree${i}`, t, gardenPx.x + gardenPx.w * t.at[0]!, gardenPx.y + gardenPx.h * t.at[1]! + t.h / 2);
    const b = G.bench;
    sprite("garden.bench", b, gardenPx.x + gardenPx.w * b.at[0]!, gardenPx.y + gardenPx.h * b.at[1]!);
  }

  // ---------------------------------------------------------------- wall tops
  // Every wall, minus its doorways. Horizontal walls with a band sit on top of it; vertical walls
  // run from the band at their top end down to the one at their bottom end.
  const top = tileset.walls.top;
  const bandAt = (y: number) => banding.bands.find((b) => b.y === y);
  const trim = (x0: number, y0: number, x1: number, y1: number) => nine(ctx, img(top.image), top, top.slice, Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0));
  for (const w of plan.walls) {
    const doors = plan.doors.filter((d) => d.wall === w.id);
    if (w.y1 === w.y2) {
      const band = bandAt(w.y1);
      const y0 = band ? band.top : southEdge(w.y1);
      let x = Math.min(w.x1, w.x2);
      const end = Math.max(w.x1, w.x2);
      const gaps = doors.map((d) => [Math.min(d.x1, d.x2), Math.max(d.x1, d.x2)]).sort((p, q) => p[0]! - q[0]!);
      for (const [a, b] of [...gaps, [end, end]]) {
        if (a! > x) trim(X(x) - (x === Math.min(w.x1, w.x2) ? TRIM_PX / 2 : 0), y0, X(a!) + (a === end ? TRIM_PX / 2 : 0), y0 + TRIM_PX);
        x = Math.max(x, b!);
      }
    } else {
      const [a, b] = [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)];
      const upper = bandAt(a);
      const lower = bandAt(b);
      const y0 = upper ? upper.top : southEdge(a);
      const y1 = lower ? lower.top + TRIM_PX : southEdge(b) + TRIM_PX;
      const gaps = doors.map((d) => [banding.y(Math.min(d.y1, d.y2)), banding.y(Math.max(d.y1, d.y2))] as const).sort((p, q) => p[0] - q[0]);
      let y = y0;
      for (const [g0, g1] of [...gaps, [y1, y1] as const]) {
        if (g0 > y) trim(X(w.x1) - TRIM_PX / 2, y, X(w.x1) + TRIM_PX / 2, g0);
        y = Math.max(y, g1);
      }
    }
  }

  // ---------------------------------------------------------------- furniture
  const sofaOf = new Map<string, string[]>();
  for (const pair of tileset.sofas.pairs) if (pair.every((id) => byId(id))) for (const id of pair) sofaOf.set(id, pair);
  for (const f of plan.furniture) {
    const pair = sofaOf.get(f.id);
    if (pair) {
      if (pair[0] === f.id) paintSofa(pair.map((id) => byId(id)!), facings.get(f.id) ?? "east");
      continue;
    }
    const p = paintFurniture(f, plan, banding, images, facings.get(f.id) ?? "south");
    if (p) pieces.push(p);
  }

  /** Neighbouring armchairs drawn as one sofa (their seat points stay where they are). */
  function paintSofa(seats: Furniture[], facing: Dir): void {
    const s = (tileset.sofas.facings as Record<string, Src | undefined>)[facing] ?? tileset.sofas.facings.east;
    const r = screenRect(bounds(seats.map((f) => f.rect), 0));
    // Under both sitters: sorted just above the nearer seat's top.
    sprite(`sofa:${seats.map((f) => f.id).join("+")}`, s, r.x + r.w / 2, r.y + r.h + (r.h + 16 - s.h) / 2 + 8, r.y - 1);
  }

  // ---------------------------------------------------------------- decor
  const D = tileset.decor;
  const chairs = plan.furniture.filter((f) => f.kind === "chair");
  const taken = new Map<string, Rect[]>(); // room -> footprints along the outer wall
  for (const bed of beds) {
    // A bedside cabinet with a lamp at the head of the bed, on its chair's side.
    const chair = chairs
      .filter((c) => c.room === bed.room)
      .sort((p, q) => distToRect(bed.rect, p.rect.x, p.rect.y) - distToRect(bed.rect, q.rect.x, q.rect.y))[0];
    const east = chair ? chair.rect.x + chair.rect.w / 2 >= bed.rect.x + bed.rect.w / 2 : true;
    const foot: Rect = { x: east ? bed.rect.x + bed.rect.w : bed.rect.x - 0.5, y: bed.rect.y, w: 0.5, h: 0.5 };
    const r = screenRect(foot);
    const cab = D.bedside.cabinet, lamp = D.bedside.lamp;
    const h = cab.h - lamp.dy - cab.h + lamp.h; // the lamp stands on the cabinet's top
    const total = Math.max(cab.h, -lamp.dy + lamp.h);
    piece(`${bed.id}.cabinet`, cab.w, total, r.x + r.w / 2 - cab.w / 2, r.y + r.h - total, r.y + r.h, (c) => {
      c.drawImage(img(cab.image), cab.x, cab.y, cab.w, cab.h, 0, total - cab.h, cab.w, cab.h);
      c.drawImage(img(lamp.image), lamp.x, lamp.y, lamp.w, lamp.h, Math.round((cab.w - lamp.w) / 2), total + lamp.dy - lamp.h + h - h, lamp.w, lamp.h);
    });
    lamps.push({ x: r.x + r.w / 2, y: r.y + r.h + lamp.dy - lamp.h / 2 });
    const list = taken.get(bed.room) ?? [];
    list.push(bed.rect, foot);
    taken.set(bed.room, list);
  }
  // A wardrobe against the outer wall of each bedroom, in the widest gap.
  for (const room of plan.rooms.filter((r) => D.wardrobe.rooms.includes(r.kind))) {
    const used = (taken.get(room.id) ?? []).map((r) => [r.x, r.x + r.w] as const).sort((p, q) => p[0] - q[0]);
    let best: [number, number] | null = null;
    let x = room.rect.x;
    for (const [a, b] of [...used, [room.rect.x + room.rect.w, room.rect.x + room.rect.w] as const]) {
      if (a - x > (best ? best[1] - best[0] : 0)) best = [x, a];
      x = Math.max(x, b);
    }
    const wd = D.wardrobe;
    if (!best || best[1] - best[0] < wd.w / TILE_PX) continue;
    const r = screenRect({ x: (best[0] + best[1]) / 2 - 0.5, y: room.rect.y, w: 1, h: 0.5 });
    sprite(`${room.id}.wardrobe`, wd, r.x + r.w / 2, r.y + r.h);
  }
  // Plants in free corners of the day rooms.
  for (const room of plan.rooms.filter((r) => D.plants.rooms.includes(r.kind))) {
    const { x, y, w, h } = room.rect;
    const inset = D.plants.inset;
    // Not the corner holding the room's label: bottom-left for bedrooms and the Lounge, else top-left.
    const labelAtBottom = room.kind === "bedroom" || room.kind === "lounge";
    const corners = [
      [x + inset, y + inset],
      [x + w - inset, y + inset],
      [x + inset, y + h - inset],
      [x + w - inset, y + h - inset],
    ].filter((_, i) => i !== (labelAtBottom ? 2 : 0));
    let placed = 0;
    for (const [cx, cy] of corners as [number, number][]) {
      if (placed >= 2) break;
      const clear = D.plants.clear;
      const nearFurniture = plan.furniture.some((f) => f.room === room.id && distToRect(f.rect, cx, cy) < (D.plants.tall.includes(f.kind) ? D.plants.clearTall : clear));
      const nearPoint = plan.points.some((p) => p.room === room.id && Math.hypot(p.x - cx, p.y - cy) < clear);
      const nearDoor = plan.doors.some((d) => d.rooms.includes(room.id) && distToRect({ x: Math.min(d.x1, d.x2), y: Math.min(d.y1, d.y2), w: Math.abs(d.x2 - d.x1), h: Math.abs(d.y2 - d.y1) }, cx, cy) < clear + 0.5);
      if (nearFurniture || nearPoint || nearDoor) continue;
      const k = (placed + room.id.length) % D.plants.count;
      const s = { image: D.plants.image, x: k * D.plants.w, y: 0, w: D.plants.w, h: D.plants.h };
      sprite(`${room.id}.plant${placed}`, s, X(cx), rigid(cy) + 4);
      placed++;
    }
  }

  return { base, size: { w: W, h: H }, furniture: pieces, lamps };
}

function paintFurniture(f: Furniture, plan: FloorPlan, banding: Banding, images: Images, facing: Dir): FurniturePiece | null {
  const at = f.rect.y + f.rect.h / 2;
  const rigid = (m: number) => m * TILE_PX + banding.offsetAt(at);
  const left = banding.x(f.rect.x), right = banding.x(f.rect.x + f.rect.w);
  const topY = rigid(f.rect.y), bottom = rigid(f.rect.y + f.rect.h);
  const cx = (left + right) / 2;
  const cy = rigid(at);
  const img = (k: string) => images[k as keyof Images];
  const F = tileset.furniture;
  const make = (w: number, h: number, x: number, y: number, z: number, draw: (ctx: CanvasRenderingContext2D) => void): FurniturePiece => {
    const [c, ctx] = canvas(w, h);
    draw(ctx);
    return { id: f.id, canvas: c, x: Math.round(x), y: Math.round(y), z };
  };
  const whole = (s: Src & { dy?: number }, x: number, bottomY: number, z: number) =>
    make(s.w, s.h, x - s.w / 2, bottomY - s.h, z, (ctx) => ctx.drawImage(img(s.image), s.x, s.y, s.w, s.h, 0, 0, s.w, s.h));
  const sliced = (s: Src & { lift: number; slice: Slice }, z: number) => {
    const w = s.slice.l + s.slice.r > 0 ? right - left : s.w;
    const h = bottom - topY + s.lift;
    const x = s.slice.l + s.slice.r > 0 ? left : cx - s.w / 2;
    return make(w, h, x, bottom - h, z, (ctx) => nine(ctx, img(s.image), s, s.slice, 0, 0, w, h));
  };

  switch (f.kind) {
    case "bed":
      // Sorted by its head end, so anyone beside or at the foot of the bed is drawn over it.
      return whole(F.bed, cx, bottom + F.bed.dy, topY);
    case "chair":
    case "armchair": {
      const rule = f.kind === "chair" ? F.chair : F.armchair;
      const [sx, sy] = rule.facings[facing];
      // Facing away, the backrest is nearer to us than the sitter, so it's drawn over them.
      const z = facing === "north" ? cy + 1 : cy;
      return make(rule.w, rule.h, cx - rule.w / 2, bottom + rule.dy - rule.h, z, (ctx) => ctx.drawImage(img(rule.image), sx!, sy!, rule.w, rule.h, 0, 0, rule.w, rule.h));
    }
    case "table": {
      const small = F.table.find((t) => "maxSize" in t && f.rect.w <= t.maxSize! && f.rect.h <= t.maxSize!);
      if (small) return whole(small as Src, cx, bottom + ((small as { dy?: number }).dy ?? 0), cy);
      return sliced(F.table.find((t) => "slice" in t) as Src & { lift: number; slice: Slice }, cy);
    }
    case "desk":
      return sliced(F.desk, cy);
    case "bookshelf": {
      const piece = sliced(F.bookshelf, cy);
      const o = F.bookshelf.overlay;
      piece.canvas.getContext("2d")!.drawImage(img(o.image), o.x, o.y, o.w, o.h, o.dx, o.dy, o.w, o.h);
      return piece;
    }
    case "tv": {
      const t = F.tv;
      const h = bottom - topY + t.lift;
      const o = t.overlay;
      // The screen faces into the room: west when the TV stands against an east wall.
      const room = plan.rooms.find((r) => r.id === f.room)!;
      const facesWest = f.rect.x + f.rect.w / 2 > room.rect.x + room.rect.w / 2;
      const w = Math.max(t.w, o.w - o.dx * 2);
      const ox = Math.round((w - t.w) / 2);
      const extra = o.h;
      return make(w, h + extra, cx - w / 2, bottom - h - extra, cy, (ctx) => {
        for (const p of t.parts) ctx.drawImage(img(t.image), t.x, t.y + p.sy, t.w, p.sh, ox, h + extra + p.dy, t.w, p.sh);
        ctx.drawImage(img(o.image), facesWest ? 0 : o.w, 0, o.w, o.h, ox + o.dx, h + extra + o.dy - o.h, o.w, o.h);
      });
    }
    case "wc": {
      const wc = F.wc;
      const point = plan.points.find((p) => p.kind === "wc" && p.room === f.room);
      const x = point ? banding.x(point.x) : cx;
      const seat = point ? rigid(point.y) : cy;
      return whole(wc, x, seat + 10 + wc.dy, seat);
    }
    default:
      return null;
  }
}

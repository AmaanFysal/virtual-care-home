// Metres <-> world pixels for the pixel-art wing (docs/08 "Pixel-art map"). Display only.
//
// 1 m = 32 px (one LPC tile). In the 3/4 view a wall facing south shows its face, which the
// floor plan gives no room for (walls have no thickness). So the drawing inserts a FACE_PX band
// at each horizontal wall line that has a room directly below it (the north outer wall, the
// bedroom-corridor wall, the corridor-south rooms wall). Everything below a band moves down by
// FACE_PX. Where a line has rooms on both sides, the band is blended over +/-BLEND_M either side of
// it, so people walking through a doorway cross the face smoothly instead of jumping.
//
// Every screen <-> world conversion (drawing, click-to-select, hover, Follow, the camera) goes
// through one Banding, so what's drawn and what's picked always agree.

import type { FloorPlan } from "@vch/shared-types";

export const TILE_PX = 32;
export const FACE_PX = 64;
/** The wall-top trim along the top of each face, and the thickness of vertical walls. */
export const TRIM_PX = 8;
/** Room around the map for the outer wall trims. */
export const PAD_PX = TRIM_PX;
/** Half-width of the blend around a wall line with rooms on both sides (a doorway crossing). */
export const BLEND_M = 0.25;

export interface Band {
  /** The wall line, in metres. */
  y: number;
  /** World-pixel top of the band (the top of its trim). */
  top: number;
  /** Rooms on both sides: people cross it through doors, so the mapping blends. */
  blended: boolean;
}

export interface Banding {
  bands: Band[];
  /** Map size in world pixels, including the padding for the outer trims. */
  size: { w: number; h: number };
  x(m: number): number;
  y(m: number): number;
  toScreen(p: { x: number; y: number }): { x: number; y: number };
  toWorld(p: { x: number; y: number }): { x: number; y: number };
  /** The pixel offset the bands add at a point, for drawing a whole object without stretching it. */
  offsetAt(m: number): number;
}

/** Piecewise-linear, strictly increasing: [metres, pixels] breakpoints, slope TILE_PX outside them. */
type Knots = [number, number][];

function interpolate(knots: Knots, v: number, from: 0 | 1): number {
  const to = from === 0 ? 1 : 0;
  const slope = from === 0 ? TILE_PX : 1 / TILE_PX;
  const first = knots[0]!;
  if (v <= first[from]) return first[to] + (v - first[from]) * slope;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1]!;
    const b = knots[i]!;
    if (v <= b[from]) return a[to] + ((v - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
  }
  const last = knots[knots.length - 1]!;
  return last[to] + (v - last[from]) * slope;
}

export function makeBanding(plan: FloorPlan): Banding {
  const lines = [...new Set(plan.walls.filter((w) => w.y1 === w.y2).map((w) => w.y1))].sort((a, b) => a - b);
  // Only rooms that aren't inside another make bands: an en-suite's short internal walls are drawn
  // as wall tops, since a face band there would push the whole map down (docs/08).
  const inside = (a: FloorPlan["rooms"][number], b: FloorPlan["rooms"][number]) =>
    a !== b && a.rect.x >= b.rect.x && a.rect.y >= b.rect.y && a.rect.x + a.rect.w <= b.rect.x + b.rect.w && a.rect.y + a.rect.h <= b.rect.y + b.rect.h;
  const topLevel = plan.rooms.filter((r) => !plan.rooms.some((o) => inside(r, o)));
  const bands: Band[] = [];
  const knots: Knots = [];
  let shift = PAD_PX;
  for (const line of lines) {
    const below = topLevel.some((r) => r.rect.y === line);
    if (!below) continue;
    const above = topLevel.some((r) => r.rect.y + r.rect.h === line);
    bands.push({ y: line, top: line * TILE_PX + shift, blended: above });
    if (above) {
      knots.push([line - BLEND_M, (line - BLEND_M) * TILE_PX + shift]);
      shift += FACE_PX;
      knots.push([line + BLEND_M, (line + BLEND_M) * TILE_PX + shift]);
    } else {
      // Nothing above to walk in from: the band simply sits above the rooms.
      shift += FACE_PX;
      knots.push([line, line * TILE_PX + shift]);
    }
  }
  if (knots.length === 0) knots.push([0, PAD_PX]);
  const x = (m: number) => PAD_PX + m * TILE_PX;
  const y = (m: number) => interpolate(knots, m, 0);
  return {
    bands,
    size: { w: Math.ceil(x(plan.size.w) + PAD_PX), h: Math.ceil(y(plan.size.h) + PAD_PX) },
    x,
    y,
    toScreen: (p) => ({ x: x(p.x), y: y(p.y) }),
    toWorld: (p) => ({ x: (p.x - PAD_PX) / TILE_PX, y: interpolate(knots, p.y, 1) }),
    // The bands above m; a blended band counts once m is past its line.
    offsetAt: (m) => PAD_PX + bands.filter((b) => m >= b.y).length * FACE_PX,
  };
}

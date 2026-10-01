// Doors and windows on the pixel-art map (v1.0-testbed, docs/08): where each is drawn, and an
// overlay for their states as the server sends them. Display only: it draws `BuildingView` and
// never decides a state.

import type { Graphics } from "pixi.js";
import type { BuildingView, Door, FloorPlan } from "@vch/shared-types";
import { FACE_PX, TILE_PX, TRIM_PX, type Banding } from "./banding";
import tileset from "./tileset.json";

const WOOD = 0x8a5a35;
const WOOD_EDGE = 0x5b3a22;
const HANDLE = 0xd9b24c;
const KEYPAD = 0x30363b;
const GAP = 0x22303a;
const SASH = 0xe9eef0;

/** Where a window is drawn: the LPC window on a wall face band, or a small pane on the front wall. */
export interface WindowSpot {
  id: string;
  kind: "face" | "front";
  /** Centre x, top y, width and height of the glass, in world pixels. */
  cx: number;
  y: number;
  w: number;
  h: number;
}

/** Screen y of a floor-plan y on the south side of a wall line (the painter's `southEdge`). */
function southEdge(banding: Banding, y: number): number {
  return y * TILE_PX + banding.offsetAt(y - 1e-6);
}

export function windowSpots(plan: FloorPlan, banding: Banding): WindowSpot[] {
  const win = tileset.walls.window;
  const glass = win.parts[0]!;
  return plan.windows.map((w) => {
    const cx = banding.x((w.x1 + w.x2) / 2);
    const band = banding.bands.find((b) => b.y === w.y1);
    if (band) return { id: w.id, kind: "face", cx, y: band.top + TRIM_PX + glass.dy, w: glass.w, h: glass.h };
    // The front wall seen from the garden is short: a small pane on it.
    const width = Math.round(Math.abs(w.x2 - w.x1) * TILE_PX * 0.8);
    return { id: w.id, kind: "front", cx, y: southEdge(banding, w.y1) + TRIM_PX + 4, w: width, h: tileset.walls.exterior.southHeight - 8 };
  });
}

/** The full leaf of a closed door, in world pixels, and which way it runs. */
function doorLeaf(plan: FloorPlan, banding: Banding, d: Door): { x: number; y: number; w: number; h: number; horizontal: boolean } {
  if (d.y1 === d.y2) {
    const a = banding.x(Math.min(d.x1, d.x2)) + 3;
    const b = banding.x(Math.max(d.x1, d.x2)) - 3;
    const band = banding.bands.find((x) => x.y === d.y1);
    // On a wall face band: the leaf fills the doorway's face. On the front wall: the trim and front face.
    if (band) return { x: a, y: band.top + TRIM_PX, w: b - a, h: FACE_PX - TRIM_PX, horizontal: true };
    const y = southEdge(banding, d.y1);
    return { x: a, y, w: b - a, h: TRIM_PX + tileset.walls.exterior.southHeight, horizontal: true };
  }
  const y0 = banding.y(Math.min(d.y1, d.y2));
  const y1 = banding.y(Math.max(d.y1, d.y2));
  return { x: banding.x(d.x1) - TRIM_PX / 2, y: y0, w: TRIM_PX, h: y1 - y0, horizontal: false };
}

/** Redraws every door leaf and open window from the server's building view. */
export function drawBuilding(g: Graphics, plan: FloorPlan, banding: Banding, building: BuildingView): void {
  g.clear();
  const doors = new Map(plan.doors.map((d) => [d.id, d]));
  for (const state of building.doors) {
    const door = doors.get(state.doorId);
    if (!door || state.state === "open") continue;
    const leaf = doorLeaf(plan, banding, door);
    // Ajar: a little under half the leaf, the rest of the doorway open.
    const part = state.state === "ajar" ? 0.45 : 1;
    const w = leaf.horizontal ? Math.round(leaf.w * part) : leaf.w;
    const h = leaf.horizontal ? leaf.h : Math.round(leaf.h * part);
    g.rect(leaf.x, leaf.y, w, h).fill({ color: WOOD }).stroke({ width: 1, color: WOOD_EDGE, alignment: 1 });
    if (leaf.horizontal && state.state !== "ajar") {
      // Panels and a handle, so it reads as a door at a glance.
      g.rect(leaf.x + 3, leaf.y + 4, w - 6, Math.round(h / 2) - 6).stroke({ width: 1, color: WOOD_EDGE });
      g.rect(leaf.x + w - 6, leaf.y + Math.round(h / 2), 3, 3).fill({ color: HANDLE });
    }
    if (state.state === "locked") g.rect(leaf.x + w - 7, leaf.y + Math.round(h / 2) - 7, 5, 5).fill({ color: KEYPAD });
  }
  const open = new Set(building.windows.filter((w) => w.state === "open").map((w) => w.windowId));
  for (const spot of windowSpots(plan, banding)) {
    if (!open.has(spot.id)) continue;
    // The lower sash pushed out on its restrictor: a dark gap and a pale frame edge across the pane.
    const x = Math.round(spot.cx - spot.w / 2) + 6;
    const gapY = spot.y + Math.round(spot.h * 0.42);
    g.rect(x, gapY, spot.w - 12, 3).fill({ color: GAP });
    g.rect(x, gapY + 3, spot.w - 12, 1).fill({ color: SASH });
  }
}

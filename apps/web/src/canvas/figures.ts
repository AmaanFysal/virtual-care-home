// Pure display helpers for the pixel-art people (no Pixi): which way someone faces, which pose and
// icon to show, where their figure is drawn, and which figure a click lands on. The renderer
// draws with these and picks with these, through the same Banding, so a click on a drawn person
// always selects that person. Everything is derived from what the server sent.

import type { FloorPlan, Furniture, PersonView } from "@vch/shared-types";
import type { Banding } from "./banding";
import tileset from "./tileset.json";

export type Dir = "north" | "west" | "south" | "east";
export type IconName = "meal" | "drink" | "meds" | "care" | "asleep" | "notes" | "chatting" | "visiting" | "break" | "fall" | "observe";

/** A seated figure is drawn this many pixels lower, so they sit down onto the seat. */
export const SIT_DY = 12;

/** How far someone must move (metres) before their facing follows the movement. */
const TURN_EPS = 0.01;

/** Faces along the dominant axis of a movement; keeps the old facing when barely moving. */
export function directionOf(dx: number, dy: number, prev: Dir): Dir {
  if (Math.abs(dx) < TURN_EPS && Math.abs(dy) < TURN_EPS) return prev;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

type Rect = { x: number; y: number; w: number; h: number };

/** The distance between two rects, and the way from a to b: along the axis they're apart on. */
function towards(a: Rect, b: Rect): { d: number; dir: Dir } {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const d = Math.hypot(Math.max(0, -overlapX), Math.max(0, -overlapY));
  const alongY = overlapX > 0 || (overlapY <= 0 && -overlapY > -overlapX);
  return { d, dir: alongY ? (dy > 0 ? "south" : "north") : dx > 0 ? "east" : "west" };
}

/**
 * Which way each seat faces: towards the nearest table or desk in its room for a chair, towards
 * the TV for an armchair (tileset.json "facesTowards", "within" metres), otherwise south, towards
 * the camera (bedside chairs), so the person sitting there shows their face.
 */
export function seatFacings(plan: FloorPlan): Map<string, Dir> {
  const facings = new Map<string, Dir>();
  for (const seat of plan.furniture) {
    const rule = seat.kind === "chair" ? tileset.furniture.chair : seat.kind === "armchair" ? tileset.furniture.armchair : null;
    if (!rule) continue;
    let best: { d: number; dir: Dir } | null = null;
    for (const target of plan.furniture) {
      if (target.room !== seat.room || !rule.facesTowards.includes(target.kind)) continue;
      const t = towards(seat.rect, target.rect);
      if (t.d <= rule.within && (!best || t.d < best.d)) best = t;
    }
    facings.set(seat.id, best?.dir ?? "south");
  }
  return facings;
}

/** The seat (chair or armchair) a sitting person is on, if any. */
export function seatAt(plan: FloorPlan, x: number, y: number): Furniture | undefined {
  return plan.furniture.find((f) => (f.kind === "chair" || f.kind === "armchair") && x >= f.rect.x && x <= f.rect.x + f.rect.w && y >= f.rect.y && y <= f.rect.y + f.rect.h);
}

/**
 * Someone standing still in a WC area (e.g. restocking it) faces the toilet: the direction from
 * where they stand to the WC seat point. Null anywhere else, or on the seat itself.
 */
export function facingFixture(plan: FloorPlan, x: number, y: number): Dir | null {
  const wc = plan.furniture.find((f) => f.kind === "wc" && x >= f.rect.x && x <= f.rect.x + f.rect.w && y >= f.rect.y && y <= f.rect.y + f.rect.h);
  const seat = wc && plan.points.find((p) => p.kind === "wc" && p.room === wc.room);
  if (!seat || (Math.abs(seat.x - x) < 0.01 && Math.abs(seat.y - y) < 0.01)) return null;
  return directionOf(seat.x - x, seat.y - y, "south");
}

/** The name-tag icon for what someone is doing, from their badges, posture and task label. */
export function activityIcon(view: Pick<PersonView, "kind" | "posture" | "badges" | "task">): IconName | null {
  const b = new Set(view.badges);
  const task = view.task ?? "";
  // Red only while someone is on the floor (or a carer is with them, or phoning the RN about them);
  // a calmer icon once they're up, on post-fall observations (cleared when those end).
  if (view.posture === "on_floor" || b.has("alert") || b.has("phone")) return "fall";
  if (b.has("obs")) return "observe";
  if (b.has("asleep") || view.posture === "dozing") return "asleep";
  if (b.has("pill")) return "meds";
  if (b.has("tray") || task.startsWith("Lunch")) return "meal";
  if (b.has("cup")) return "drink";
  if (b.has("towel") || b.has("hoist")) return "care";
  if (b.has("break")) return "break";
  if (b.has("handover") || task.startsWith("Writing care notes")) return "notes";
  if (task.startsWith("Visiting") || (view.kind === "visitor" && view.posture === "sitting")) return "visiting";
  if (task === "Chatting" || task.startsWith("Sitting with")) return "chatting";
  return null;
}

/** A slide along straight segments through turning points (world metres), by distance. */
export interface Slide {
  points: { x: number; y: number }[];
  /** Distance from the first point to each point. */
  cum: number[];
}

export function makeSlide(points: { x: number; y: number }[]): Slide {
  const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return { points: pts, cum };
}

/** The point a fraction k (0 to 1) of the way along a slide, by distance. */
export function slideAt(s: Slide, k: number): { x: number; y: number } {
  const total = s.cum[s.cum.length - 1]!;
  if (s.points.length === 1 || total === 0 || k >= 1) return s.points[s.points.length - 1]!;
  const d = Math.max(0, k) * total;
  let i = 1;
  while (i < s.cum.length - 1 && s.cum[i]! < d) i++;
  const a = s.points[i - 1]!, b = s.points[i]!;
  const seg = s.cum[i]! - s.cum[i - 1]!;
  const f = seg === 0 ? 1 : (d - s.cum[i - 1]!) / seg;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** Where the slide is at k, followed by the turning points still ahead (so a new slide can carry on from there). */
export function slideRest(s: Slide, k: number): { x: number; y: number }[] {
  const here = slideAt(s, k);
  const d = Math.min(1, Math.max(0, k)) * s.cum[s.cum.length - 1]!;
  return [here, ...s.points.filter((_, i) => s.cum[i]! > d)];
}

/** Where a figure is drawn and clicked, in world pixels. */
export interface FigureBox {
  id: string;
  /** Screen position of the feet (or head, in bed): the drawing anchor and the y-sort key. */
  anchor: { x: number; y: number };
  box: Rect;
}

/** The clickable box of someone's drawn figure, relative to where they are (world metres). */
export function figureBox(view: Pick<PersonView, "id" | "posture">, pos: { x: number; y: number }, banding: Banding, scale = 1): FigureBox {
  const anchor = banding.toScreen(pos);
  if (view.posture === "in_bed") {
    // The head on the pillow: the bed sprite's pillow, the bed point being the bed's centre.
    const bed = tileset.furniture.bed;
    const head = { x: anchor.x - bed.w / 2 + bed.pillow.x, y: anchor.y - bed.h / 2 + bed.pillow.y };
    return { id: view.id, anchor: head, box: { x: head.x - 10, y: head.y - 12, w: 20, h: 20 } };
  }
  if (view.posture === "on_floor") return { id: view.id, anchor, box: { x: anchor.x - 22, y: anchor.y - 18, w: 44, h: 22 } };
  const seated = view.posture === "sitting" || view.posture === "dozing";
  const tall = (seated ? 40 : 48) * scale;
  const half = 12 * scale;
  const feet = anchor.y + (seated ? SIT_DY : 0);
  return { id: view.id, anchor, box: { x: anchor.x - half, y: feet - tall, w: half * 2, h: tall + 3 } };
}

/** The person under a world-pixel point: the front-most (lowest on screen) of those hit. */
export function pickPerson(figures: FigureBox[], p: { x: number; y: number }): string | null {
  let hit: FigureBox | null = null;
  for (const f of figures) {
    const { x, y, w, h } = f.box;
    if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) continue;
    if (!hit || f.anchor.y >= hit.anchor.y) hit = f;
  }
  return hit?.id ?? null;
}

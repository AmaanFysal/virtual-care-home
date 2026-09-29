// What the browser draws between updates (docs/08 "Smooth movement"): each person slides from
// where they were drawn, through the turning points the server sends (`via`), to their new
// position. At every speed, every one of those straight segments must stay on walkable floor or
// in a doorway: never across a wall, never through blocking furniture.

import { describe, expect, it } from "vitest";
import type { ClockSpeed, PersonView, ServerMessage } from "@vch/shared-types";
import { createSim } from "@vch/sim-engine";
import { loadWorldData } from "@vch/sim-engine/load-data";
import { EventLog } from "../src/eventlog.js";
import { Runner } from "../src/runner.js";

const data = loadWorldData();

interface Grid {
  cols: number;
  rows: number;
  cell: number;
  walkable: boolean[];
  blockedEdges: Set<string>;
}
type Pt = { x: number; y: number };

const edge = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const cellAt = (g: Grid, p: Pt) => Math.min(g.rows - 1, Math.max(0, Math.floor(p.y / g.cell))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / g.cell)));
const open = (g: Grid, a: number, b: number) => g.walkable[a]! && g.walkable[b]! && !g.blockedEdges.has(edge(a, b));

/** Moving from cell a to cell b is allowed: the same cell, an open orthogonal edge, or a diagonal with no corner cut. */
function stepAllowed(g: Grid, a: number, b: number): boolean {
  if (a === b) return true;
  const [ca, ra, cb, rb] = [a % g.cols, Math.floor(a / g.cols), b % g.cols, Math.floor(b / g.cols)];
  if (Math.abs(ca - cb) + Math.abs(ra - rb) === 1) return open(g, a, b);
  if (Math.abs(ca - cb) === 1 && Math.abs(ra - rb) === 1) {
    const [m1, m2] = [ra * g.cols + cb, rb * g.cols + ca];
    return (open(g, a, m1) && open(g, m1, b)) || (open(g, a, m2) && open(g, m2, b));
  }
  return false;
}

/** A straight segment, sampled every 2 cm, stays on walkable floor and never crosses a wall. */
function segmentOnFloor(g: Grid, p: Pt, q: Pt): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.02));
  let prev = cellAt(g, p);
  if (!g.walkable[prev]) return false;
  for (let i = 1; i <= n; i++) {
    const c = cellAt(g, { x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n });
    if (!stepAllowed(g, prev, c)) return false;
    prev = c;
  }
  return true;
}

function drawnPaths(speed: ClockSpeed, hours: number) {
  const log = new EventLog(":memory:", { runId: "paths", seed: "1", startT: 108000, dataVersion: "x", createdWallclock: "now" });
  const sim = createSim({ seed: "1", data });
  const runner = new Runner(sim, data, log);
  const received: ServerMessage[] = [];
  runner.connect({ send: (m) => received.push(m) });
  const grid = sim.world.grid as unknown as Grid;
  const beds = new Set(data.floorplan.points.filter((p) => p.kind === "bed").map((p) => `${p.x},${p.y}`));
  const drawn = new Map<string, PersonView>();
  for (const p of (received[0] as Extract<ServerMessage, { type: "snapshot" }>).people) drawn.set(p.id, p);
  runner.handle({ type: "set_speed", speed });
  runner.handle({ type: "resume" });
  const stats = { segments: 0, turns: 0, roomChanges: 0, arrivals: 0, bad: [] as string[] };
  let ms = 0;
  runner.frame(0);
  while (runner.clock().tick < hours * 720) {
    received.length = 0;
    runner.frame((ms += 100));
    for (const m of received) {
      if (m.type !== "delta") continue;
      for (const v of m.people) {
        const was = drawn.get(v.id)!;
        drawn.set(v.id, v);
        if (!v.onMap) continue;
        const via = v.via ?? [];
        const appear = !was.onMap;
        if (appear) stats.arrivals += 1;
        const points: Pt[] = [...(appear ? [] : [was]), ...via, v];
        stats.turns += via.length;
        if (was.roomId !== v.roomId) stats.roomChanges += 1;
        for (let i = 1; i < points.length; i++) {
          const [a, b] = [points[i - 1]!, points[i]!];
          if (a.x === b.x && a.y === b.y) continue;
          // Getting into or out of bed: the bed itself isn't floor.
          if (beds.has(`${a.x},${a.y}`) || beds.has(`${b.x},${b.y}`)) continue;
          stats.segments += 1;
          if (!segmentOnFloor(grid, a, b) && stats.bad.length < 5) stats.bad.push(`${v.id} (${a.x.toFixed(2)}, ${a.y.toFixed(2)}) -> (${b.x.toFixed(2)}, ${b.y.toFixed(2)}) at tick ${runner.clock().tick}`);
        }
      }
    }
  }
  return stats;
}

describe("drawn movement between updates", () => {
  // 06:00 to 11:00 covers the handover, the morning round, walks between every room, the Lounge
  // (around its tables and chairs) and visitors arriving.
  for (const [speed, hours] of [
    [10, 3],
    [60, 5],
    [360, 5],
  ] as const) {
    it(`stays on walkable floor or in doorways at ${speed}x`, () => {
      const s = drawnPaths(speed, hours);
      expect(s.bad).toEqual([]);
      expect(s.segments).toBeGreaterThan(200);
      expect(s.turns).toBeGreaterThan(50);
      expect(s.roomChanges).toBeGreaterThan(20);
    }, 60000);
  }
});

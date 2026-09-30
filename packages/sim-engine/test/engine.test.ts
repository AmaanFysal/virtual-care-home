import { describe, expect, it } from "vitest";
import { DEFAULT_START_T, TICK_SECONDS, clockToSeconds, type AnySimEvent, type SimInput } from "@vch/shared-types";
import { createSim, type Sim } from "../src/index.js";
import { createRng, createStreams } from "../src/rng.js";
import { cellAt } from "../src/world/grid.js";
import { findPath } from "../src/world/pathfind.js";
import { placeAt, walkTo } from "../src/world/movement.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const TICKS_PER_HOUR = 3600 / TICK_SECONDS;

function run(sim: Sim, hours: number, each?: (sim: Sim, events: AnySimEvent[]) => void): AnySimEvent[] {
  const all: AnySimEvent[] = [];
  for (let i = 0; i < hours * TICKS_PER_HOUR; i++) {
    const events = sim.step();
    all.push(...events);
    each?.(sim, events);
  }
  return all;
}

/** Tick at which Tuesday's clock reads `clock` (sim starts Tue 06:00). */
function tickAt(clock: string): number {
  return (clockToSeconds(clock) - clockToSeconds("06:00")) / TICK_SECONDS;
}

describe("rng", () => {
  it("is reproducible and seed-dependent", () => {
    const a = createRng("x");
    const b = createRng("x");
    const c = createRng("y");
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });

  it("keeps streams independent", () => {
    const one = createStreams("1");
    const two = createStreams("1");
    for (let i = 0; i < 100; i++) two.visitors.next(); // extra draws in another stream
    expect(two.rota.next()).toBe(one.rota.next());
  });
});

describe("determinism", () => {
  it("gives a byte-identical event log and final state for the same seed", () => {
    const a = createSim({ seed: "1", data });
    const b = createSim({ seed: "1", data });
    const logA = JSON.stringify(run(a, 24));
    const logB = JSON.stringify(run(b, 24));
    expect(logB).toBe(logA);
    expect(JSON.stringify(b.people())).toBe(JSON.stringify(a.people()));
  });

  it("differs for a different seed", () => {
    const logA = JSON.stringify(run(createSim({ seed: "1", data }), 24));
    const logB = JSON.stringify(run(createSim({ seed: "2", data }), 24));
    expect(logB).not.toBe(logA);
  });

  it("replays the same inputs identically, with the input's source", () => {
    const input: SimInput = { seq: 1, applyTick: tickAt("06:40"), type: "inject_fall", payload: { residentId: "res_peggy", severity: "minor" }, source: "user" };
    const runWithFall = () => {
      const sim = createSim({ seed: "1", data });
      sim.enqueue(input);
      return run(sim, 2);
    };
    const first = runWithFall();
    expect(JSON.stringify(runWithFall())).toBe(JSON.stringify(first));
    const fell = first.find((e) => e.type === "resident.fell")!;
    expect(fell.source).toBe("user");
    expect(fell.t).toBe(DEFAULT_START_T + 40 * 60);
    expect(fell.payload).toMatchObject({ residentId: "res_peggy", roomId: "Room5" });
  });

  it("numbers events gap-free with ids derived from seq", () => {
    const events = run(createSim({ seed: "1", data }), 6);
    events.forEach((e, i) => {
      expect(e.seq).toBe(i + 1);
      expect(e.id).toBe(`e${i + 1}`);
    });
  });
});

describe("navigation grid", () => {
  const sim = createSim({ seed: "1", data });
  const { grid, points } = sim.world;

  it("reaches every standing point from the exit door", () => {
    const exit = points.get("ExitDoor")!;
    for (const p of points.values()) {
      if (p.kind === "bed") continue;
      expect(findPath(grid, cellAt(grid, exit.x, exit.y), cellAt(grid, p.x, p.y)), p.id).not.toBeNull();
    }
  });

  it("goes through doors, never walls", () => {
    // Bed A in Room 1 to Bed A in Room 2: adjacent through a wall, so the route must use the corridor.
    const w = sim.world;
    const peggySide = w.points.get("Room5.Bed.Side")!;
    const arthurSide = w.points.get("Room1.Bed.Side")!;
    const path = findPath(grid, cellAt(grid, peggySide.x, peggySide.y), cellAt(grid, arthurSide.x, arthurSide.y))!;
    const rooms = path.map((c) => grid.roomOf[c]).filter((r, i, all) => r !== all[i - 1]);
    expect(rooms).toEqual(["Room5", "Corridor", "Room1"]);
  });
});

describe("movement", () => {
  it("lets only one person through a doorway at a time", () => {
    const sim = createSim({ seed: "1", data });
    const w = sim.world;
    // Joanne and Bev are off duty at 06:00, so nothing else directs them. Send them through
    // the Room 1 door in opposite directions at the same moment.
    const [a, b] = ["stf_joanne", "stf_bev"].map((id) => w.people.get(id)!);
    placeAt(w, a!, "Room1.Bed.Side");
    placeAt(w, b!, "Corridor.West");
    walkTo(w, a!, "Corridor.West");
    walkTo(w, b!, "Room1.Bed.Side");
    const zone = w.grid.doorZones.get("D_Room1")!;
    const waits: AnySimEvent[] = [];
    for (let i = 0; i < 20; i++) {
      waits.push(...sim.step().filter((e) => e.type === "person.waited_at_door"));
      const inZone = [a!, b!].filter((p) => zone.includes(cellAt(w.grid, p.x, p.y)));
      expect(inZone.length).toBeLessThanOrEqual(1);
    }
    expect(waits.length).toBeGreaterThan(0);
    expect(a!.atPoint).toBe("Corridor.West");
    expect(b!.atPoint).toBe("Room1.Bed.Side");
  });

  it("keeps everyone on walkable ground, within walking speed, and doorways single-occupancy (5 sim days)", () => {
    const sim = createSim({ seed: "1", data });
    const w = sim.world;
    const last = new Map<string, { x: number; y: number; posture: string }>();
    run(sim, 24 * 5, () => {
      const perZone = new Map<string, number>();
      for (const id of w.order) {
        const p = w.people.get(id)!;
        if (!p.onMap) {
          last.delete(id);
          continue;
        }
        const cell = cellAt(w.grid, p.x, p.y);
        if (p.posture !== "in_bed") expect(w.grid.walkable[cell], `${id} at (${p.x}, ${p.y})`).toBe(true);
        const zone = w.grid.doorZoneOf[cell];
        if (zone) perZone.set(zone, (perZone.get(zone) ?? 0) + 1);
        const prev = last.get(id);
        // Getting into or out of bed moves a resident between the bed and the bedside without walking.
        const bedMove = prev && (prev.posture === "in_bed") !== (p.posture === "in_bed");
        if (prev && !bedMove) expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThanOrEqual(p.speed * TICK_SECONDS + 1e-6);
        last.set(id, { x: p.x, y: p.y, posture: p.posture });
      }
      for (const [zone, n] of perZone) expect(n, zone).toBeLessThanOrEqual(1);
    });
  }, 30000);
});

describe("rota", () => {
  it("starts with Florin on nights, residents in bed and the RN on call", () => {
    const sim = createSim({ seed: "1", data });
    const w = sim.world;
    const florin = w.people.get("stf_florin")!;
    expect(florin.onMap).toBe(true);
    expect(florin.staff!.duty).toBe("on_shift");
    expect(w.rnOnCall).toBe(true);
    for (const r of data.residents) expect(w.people.get(r.id)!.posture).toBe("in_bed");
    expect(sim.people().filter((p) => p.onMap && p.kind !== "resident").map((p) => p.id)).toEqual(["stf_florin"]);
  });

  it("runs Tuesday's shifts, handing the RN to on-call at 19:30", () => {
    const sim = createSim({ seed: "1", data });
    const events = run(sim, 24);
    const started = events.filter((e) => e.type === "shift.started").map((e) => e.actors[0]);
    expect(started).toEqual(["stf_maria", "stf_blessing", "stf_tom", "stf_sanjay", "stf_bev", "stf_joanne", "stf_aisha", "stf_dave", "stf_florin"]);
    const onCall = events.filter((e) => e.type.startsWith("rn.on_call")).map((e) => [e.type, e.t - DEFAULT_START_T]);
    expect(onCall).toEqual([
      ["rn.on_call_ended", 3600],
      ["rn.on_call_started", 13.5 * 3600],
    ]);
    expect(events.filter((e) => e.type === "agency.spawned")).toEqual([]);
  });

  it("spawns agency workers only for RN days and the Saturday night, and removes them after they leave", () => {
    const sim = createSim({ seed: "1", data });
    const events = run(sim, 24 * 5); // to Sun 06:00
    const spawned = events.filter((e) => e.type === "agency.spawned");
    expect(spawned.map((e) => [e.payload.shift, e.payload.role])).toEqual([
      ["rn_day", "nurse"], // Fri
      ["rn_day", "nurse"], // Sat
      ["night", "carer"], // Sat
    ]);
    expect(new Set(spawned.map((e) => e.actors[0])).size).toBe(3);
    for (const e of spawned) expect(e.actors[0]).toMatch(/^agy_/);
    const remaining = [...sim.world.people.values()].filter((p) => p.kind === "agency");
    for (const p of remaining) expect(p.staff!.shift?.ended ?? false).toBe(false);
  });

  it("brings staff in and out through the exit door", () => {
    const sim = createSim({ seed: "1", data });
    const events = run(sim, 24);
    for (const e of events.filter((e) => e.type === "person.arrived" || e.type === "person.departed")) {
      expect(e.payload).toEqual({ pointId: "ExitDoor" });
    }
    expect(events.filter((e) => e.type === "person.departed").map((e) => e.actors[0])).toContain("stf_florin");
  });
});

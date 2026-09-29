// The residents' Lounge (docs/05 "The Lounge"): the room itself, the daily routine, supervision
// and room-change logging.

import { describe, expect, it } from "vitest";
import { TICK_SECONDS, timeOfDay, type AnySimEvent, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { createSim, validateData } from "../src/index.js";
import { SUPERVISION_MINS, supervisedResidents } from "../src/lounge.js";
import { placeAt } from "../src/world/movement.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const HOUR = 3600 / TICK_SECONDS;
const at = (h: number, m = 0) => (h * 60 + m) * 60;

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

describe("the Lounge room", () => {
  it("is one lounge off the corridor, 30 to 40 m², with the waiting area kept for visitors", () => {
    const lounges = data.floorplan.rooms.filter((r) => r.kind === "lounge");
    expect(lounges.map((r) => r.id)).toEqual(["Lounge"]);
    expect(lounges[0]!.floor_area_m2).toBeGreaterThanOrEqual(30);
    expect(lounges[0]!.floor_area_m2).toBeLessThanOrEqual(40);
    expect(lounges[0]!.floor_area_m2 / 6).toBeGreaterThanOrEqual(4.1); // old NMS minimum per resident
    expect(data.floorplan.doors.some((d) => d.rooms.includes("Lounge") && d.rooms.includes("Corridor"))).toBe(true);
    expect(data.floorplan.rooms.find((r) => r.id === "WaitingArea")!.kind).toBe("waiting");
    expect(data.floorplan.rooms).toHaveLength(7);
  });

  it("is required by the validator", () => {
    const noLounge = { ...data, floorplan: { ...data.floorplan, rooms: data.floorplan.rooms.map((r) => (r.id === "Lounge" ? { ...r, kind: "waiting" as const } : r)) } };
    expect(validateData(noLounge)).toContain("floorplan: expected exactly one lounge room, found 0");
  });
});

describe("a day with the Lounge (seed 1, Tuesday: Bev is on)", () => {
  const sim = createSim({ seed: "1", data });
  const w = sim.world;
  const events: AnySimEvent[] = [];
  const lunchRoom = new Map<string, string | null>();
  const loungeAt1630: string[] = [];
  const dozing = new Set<string>();
  let unsupervisedMax = 0;
  const occupancy = new Map([...w.people.values()].map((p) => [p.id, p.onMap ? p.roomId : null]));
  const mismatches: string[] = [];
  for (let i = 0; i < 24 * HOUR; i++) {
    const step = sim.step();
    events.push(...step);
    for (const e of step) {
      if (e.type === "meal.served" && e.payload.meal === "lunch") lunchRoom.set(e.payload.residentId, w.people.get(e.payload.residentId)!.roomId);
      if (e.type === "person.entered_room") occupancy.set(e.actors[0]!, e.payload.roomId);
      if (e.type === "person.arrived" || e.type === "person.departed") occupancy.set(e.actors[0]!, null);
    }
    for (const p of w.people.values()) {
      if (p.posture === "dozing") dozing.add(p.id);
      const actual = p.onMap ? p.roomId : null;
      if ((occupancy.get(p.id) ?? null) !== actual) mismatches.push(`${p.id} at ${w.t}`);
    }
    if (supervisedResidents(w).length > 0) unsupervisedMax = Math.max(unsupervisedMax, w.t - w.loungeSeenT);
    if (timeOfDay(w.t) === at(16, 30)) for (const p of w.people.values()) if (p.resident && p.roomId === "Lounge") loungeAt1630.push(p.id);
  }
  const entered = (id: string) => ofType(events, "person.entered_room").some((e) => e.actors[0] === id && e.payload.roomId === "Lounge");
  const escorts = (id: string) => ofType(events, "task.completed").filter((e) => e.payload.kind === "care.escort" && e.payload.residentId === id).length;

  it("walks Peggy and Stan there and back with a carer; Win and Arthur go alone; Raj and Dennis stay in their room", () => {
    for (const id of ["res_peggy", "res_stan"]) {
      expect(entered(id), id).toBe(true);
      expect(escorts(id), id).toBeGreaterThanOrEqual(2);
    }
    for (const id of ["res_win", "res_arthur"]) {
      expect(entered(id), id).toBe(true);
      expect(escorts(id), id).toBe(0);
    }
    for (const id of ["res_raj", "res_dennis"]) expect(entered(id), id).toBe(false);
  });

  it("serves lunch in the Lounge to those who choose it, and Arthur in his room", () => {
    for (const id of ["res_peggy", "res_win", "res_stan"]) expect(lunchRoom.get(id), id).toBe("Lounge");
    expect(lunchRoom.get("res_arthur")).toBe("Room2");
  });

  it("runs Bev's session from 10:45 to 11:45 with the residents in the Lounge", () => {
    const started = ofType(events, "activity.started");
    const ended = ofType(events, "activity.ended");
    expect(started).toHaveLength(1);
    expect(timeOfDay(started[0]!.t)).toBe(at(10, 45));
    expect(timeOfDay(ended[0]!.t)).toBe(at(11, 45));
    expect(ended[0]!.payload.residentIds.length).toBeGreaterThanOrEqual(3);
    expect(ended[0]!.payload.staffId).toBe("stf_bev");
  });

  it("lets residents doze in a Lounge armchair at nap time (logged), and has everyone back in their rooms by 16:30", () => {
    const naps = ofType(events, "resident.fell_asleep").filter((e) => e.payload.where === "lounge");
    expect(naps.length).toBeGreaterThan(0);
    expect(dozing.size).toBeGreaterThan(0);
    expect(loungeAt1630).toEqual([]);
  });

  it("keeps a carer in the Lounge, or looking in at least every 15 minutes, while Peggy or Stan is there", () => {
    expect(unsupervisedMax).toBeLessThanOrEqual(SUPERVISION_MINS * 60);
    expect(ofType(events, "sla.breached").filter((e) => e.payload.target === "lounge_supervision")).toEqual([]);
  });

  it("logs every room change: occupancy rebuilt from the events matches the world at every tick, for everyone", () => {
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

describe("room changes outside walking", () => {
  it("logs a room change when someone is placed in another room (a hoist, a transfer)", () => {
    const sim = createSim({ seed: "1", data });
    sim.step();
    const florin = sim.world.people.get("stf_florin")!;
    const from = florin.roomId;
    placeAt(sim.world, florin, "Lounge.Post");
    const logged = sim.world.pending.find((e) => e.type === "person.entered_room" && e.actors[0] === florin.id);
    expect(logged?.payload).toEqual({ roomId: "Lounge", fromRoomId: from });
  });
});

describe("visitors in the Lounge (seed 1, a week)", () => {
  it("sit with their resident in the Lounge as well as at the bedside", () => {
    const sim = createSim({ seed: "1", data });
    const visits: SimEvent<"visit.started">[] = [];
    for (let i = 0; i < 7 * 24 * HOUR; i++) for (const e of sim.step()) if (e.type === "visit.started") visits.push(e as SimEvent<"visit.started">);
    expect(visits.some((v) => v.payload.pointId.startsWith("Lounge."))).toBe(true);
    expect(visits.some((v) => v.payload.pointId.includes(".Side") || v.payload.pointId.includes(".Chair"))).toBe(true);
  });
});

// The building (v1.0-testbed): doors and windows follow their rules on every tick, over whole
// runs in November (the default start) and in May (mild enough for windows to open).

import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY, TICK_SECONDS, clockToSeconds, simTimeAt, type AnySimEvent } from "@vch/shared-types";
import { createSim, type Sim } from "../src/index.js";
import { raining, weatherAt } from "../src/weather.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const DAY = SECONDS_PER_DAY / TICK_SECONDS;
const PRIVATE = new Set(["morning", "bedtime", "pad_change", "reposition", "comfort"]);

/** Runs `days` days, calling `check` after every tick with that tick's events; returns every problem found. */
function run(seed: string, days: number, startT: number | undefined, check: (sim: Sim, events: AnySimEvent[], problems: string[]) => void): { problems: string[]; events: AnySimEvent[] } {
  const sim = createSim({ seed, data, ...(startT ? { startT } : {}) });
  const problems: string[] = [];
  const all: AnySimEvent[] = [];
  for (let i = 0; i < days * DAY; i++) {
    const events = sim.step();
    all.push(...events);
    check(sim, events, problems);
  }
  return { problems: [...new Set(problems)].slice(0, 20), events: all };
}

function doorRules(sim: Sim, _events: AnySimEvent[], problems: string[]): void {
  const w = sim.world;
  const doors = new Map(sim.describe().doors.map((d) => [d.doorId, d]));
  for (const id of w.order) {
    const r = w.people.get(id)!;
    if (!r.resident || !r.onMap) continue;
    const roomId = w.points.get(r.resident.data.room)!.room;
    const doorId = w.data.floorplan.doors.find((d) => d.rooms.includes(roomId) && d.rooms.includes("Corridor"))!.id;
    const set = w.building!.doors.get(doorId)!.state;
    const care = [...w.tasks.values()].some(
      (t) => t.residentId === r.id && t.status === "active" && t.bt.node === "care" && ((t.kind === "care" && PRIVATE.has(String(t.data.care))) || (t.kind === "assist" && t.need === "toileting")),
    );
    if (care && set !== "closed") problems.push(`${doorId} is ${set} during personal care for ${r.id}`);
    if (!care && w.building!.night.has(r.id)) {
      const settling = [...w.tasks.values()].some((t) => t.residentId === r.id && t.status === "active" && t.bt.node === "settle the resident");
      const pref = r.resident.data.care.door_at_night ?? "closed";
      if (!settling && set !== pref) problems.push(`${doorId} is ${set} at night, but ${r.id}'s card says ${pref}`);
    }
  }
  for (const d of doors.values()) {
    if (d.heldBy === null) continue;
    const holder = w.people.get(d.heldBy)!;
    if (w.zoneOwner.get(d.doorId) !== holder.id || holder.heldZone !== d.doorId) problems.push(`${d.doorId} held by ${d.heldBy}, who isn't in its doorway`);
    if (d.state !== "open") problems.push(`${d.doorId} held but drawn ${d.state}`);
  }
  // En-suites: closed while anyone is inside.
  for (const room of w.data.floorplan.rooms.filter((r) => r.kind === "ensuite")) {
    const door = w.data.floorplan.doors.find((d) => d.rooms.includes(room.id))!;
    const inside = w.order.some((id) => w.people.get(id)!.onMap && w.people.get(id)!.roomId === room.id);
    if (inside && w.building!.doors.get(door.id)!.state !== "closed") problems.push(`${door.id} not closed while ${room.id} is in use`);
  }
}

function windowRules(sim: Sim, events: AnySimEvent[], problems: string[]): void {
  const w = sim.world;
  const s = w.data.building.windows;
  const weather = weatherAt(w.data.weather!, w.t);
  const tod = w.t % SECONDS_PER_DAY;
  for (const e of events) {
    if (e.type !== "window.opened") continue;
    if (!weather.isDay || raining(weather) || weather.tempC < s.open_min_temp_c || weather.windMps >= s.open_max_wind_mps) problems.push(`${e.payload.windowId} opened at ${e.t} in ${JSON.stringify(weather)}`);
    if (tod >= clockToSeconds(s.close_by)) problems.push(`${e.payload.windowId} opened after ${s.close_by}`);
  }
  const turned = raining(weather) || weather.tempC < s.open_min_temp_c || weather.windMps >= s.open_max_wind_mps;
  for (const win of sim.describe().windows) {
    if (win.state !== "open") continue;
    if (win.openingMm !== s.max_opening_mm) problems.push(`${win.windowId} open ${win.openingMm} mm, not the restrictor's ${s.max_opening_mm}`);
    if (tod >= clockToSeconds(s.close_by)) problems.push(`${win.windowId} still open after ${s.close_by}`);
    const staffHere = w.order.some((id) => w.people.get(id)!.onMap && w.people.get(id)!.staff && w.people.get(id)!.roomId === win.roomId);
    if (turned && staffHere) problems.push(`${win.windowId} left open in bad weather with staff in ${win.roomId}`);
  }
}

describe("doors (v1.0-testbed)", () => {
  it.each(["1", "2"])("follow their rules on every tick for a November week (seed %s)", (seed) => {
    const { problems, events } = run(seed, 7, undefined, doorRules);
    expect(problems).toEqual([]);
    // Bedroom doors close for personal care, and Stan's and Dennis's go ajar at night.
    expect(events.some((e) => e.type === "door.closed" && e.payload.doorId === "D_Room5" && /personal care/.test(e.payload.reason))).toBe(true);
    expect(events.filter((e) => e.type === "door.set_ajar" && /^night/.test(e.payload.reason)).map((e) => e.type === "door.set_ajar" && e.payload.doorId)).toEqual(expect.arrayContaining(["D_Room4", "D_Room6"]));
    expect(events.some((e) => e.type === "door.closed" && e.payload.doorId === "D_Lounge" && /overnight/.test(e.payload.reason))).toBe(true);
  }, 60000);
});

describe("windows (v1.0-testbed)", () => {
  it.each(["1", "2"])("open only in fair weather and close when they should, a May week (seed %s)", (seed) => {
    const { problems, events } = run(seed, 7, simTimeAt("2027-05-04"), windowRules);
    expect(problems).toEqual([]);
    expect(events.filter((e) => e.type === "window.opened").length).toBeGreaterThan(5);
    expect(events.some((e) => e.type === "window.opened" && /after morning care/.test(e.payload.reason))).toBe(true);
  }, 60000);

  it("stay shut in a cold November week", () => {
    const { problems } = run("3", 7, undefined, windowRules);
    expect(problems).toEqual([]);
  }, 60000);
});

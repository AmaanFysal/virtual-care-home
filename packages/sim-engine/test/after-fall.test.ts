// After a fall (docs/05): the resident's alert badge is red only while they're on the floor, a
// calmer "obs" badge shows during post-fall observations and clears when they end; a resident
// taken to hospital comes back to their own bed 3 to 10 days later with their care as before.

import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY, TICK_SECONDS, timeOfDay, type AnySimEvent, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { checkInvariants, createSim } from "../src/index.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const HOUR = 3600 / TICK_SECONDS;
const tickAt = (hours: number) => ((hours - 6) * 3600) / TICK_SECONDS; // hours after Tue 00:00

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

describe("the fall badge", () => {
  it("is the red alert only while on the floor, then the observations badge for 4 hours, then nothing", () => {
    const sim = createSim({ seed: "1", data });
    sim.enqueue({ seq: 1, applyTick: tickAt(10), type: "inject_fall", payload: { residentId: "res_win", severity: "minor" }, source: "user" });
    const events: AnySimEvent[] = [];
    const seen: { t: number; alert: boolean; obs: boolean; onFloor: boolean }[] = [];
    for (let i = 0; i < tickAt(10) + 6 * HOUR; i++) {
      events.push(...sim.step());
      const win = sim.world.people.get("res_win")!;
      seen.push({ t: sim.t, alert: win.badges.includes("alert"), obs: win.badges.includes("obs"), onFloor: win.posture === "on_floor" });
    }
    const lifted = ofType(events, "fall.lifted")[0]!;
    const ended = ofType(events, "fall.observations_ended")[0]!;
    expect(ended.payload.residentId).toBe("res_win");
    expect(ended.t - lifted.t).toBeGreaterThanOrEqual(4 * 3600);
    expect(ended.t - lifted.t).toBeLessThan(4 * 3600 + 60);
    for (const s of seen) {
      expect(s.alert, `alert at ${s.t}`).toBe(s.onFloor);
      expect(s.obs, `obs at ${s.t}`).toBe(s.t >= lifted.t && s.t < ended.t);
    }
  });
});

describe("hospital return", () => {
  it("brings a resident back to their own bed 3 to 10 days after conveyance, between 11:00 and 16:00, with checks resuming", () => {
    for (const seed of ["1", "2"]) {
      const sim = createSim({ seed, data });
      sim.enqueue({ seq: 1, applyTick: tickAt(10), type: "inject_fall", payload: { residentId: "res_arthur", severity: "serious" }, source: "user" });
      const events: AnySimEvent[] = [];
      const hard: string[] = [];
      for (let i = 0; i < tickAt(10) + 11 * 24 * HOUR; i++) {
        events.push(...sim.step());
        for (const v of checkInvariants(sim.world)) hard.push(`${v.rule}: ${v.details}`);
      }
      const conveyed = ofType(events, "resident.conveyed_to_hospital")[0]!;
      const back = ofType(events, "resident.returned_from_hospital")[0]!;
      expect(back, seed).toBeDefined();
      const days = (back.t - conveyed.t) / SECONDS_PER_DAY;
      expect(days).toBeGreaterThan(2.5);
      expect(days).toBeLessThan(10.5);
      expect(back.payload.daysAway).toBeGreaterThanOrEqual(3);
      expect(back.payload.daysAway).toBeLessThanOrEqual(10);
      expect(timeOfDay(back.t)).toBeGreaterThanOrEqual(11 * 3600);
      expect(timeOfDay(back.t)).toBeLessThanOrEqual(16 * 3600);
      // Into their own bed, their room logged, and their care profile unchanged.
      const entered = events.find((e) => e.type === "person.entered_room" && e.actors[0] === "res_arthur" && e.t === back.t);
      expect(entered?.payload).toMatchObject({ roomId: data.residents.find((r) => r.id === "res_arthur")!.room.split(".")[0] });
      const arthur = sim.world.people.get("res_arthur")!;
      expect(arthur.onMap).toBe(true);
      expect(arthur.resident!.away).toBeNull();
      expect(arthur.resident!.data).toBe(data.residents.find((r) => r.id === "res_arthur"));
      // Checked and cared for again, and no hard rule broken while away or after.
      expect(ofType(events, "resident.checked").some((e) => e.payload.residentId === "res_arthur" && e.t > back.t)).toBe(true);
      expect(ofType(events, "meal.served").some((e) => e.payload.residentId === "res_arthur" && e.t > back.t)).toBe(true);
      expect(hard).toEqual([]);
    }
  }, 60000);
});

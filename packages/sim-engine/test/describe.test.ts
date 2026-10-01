// The world description (v1.0-testbed): deterministic, never changes a run, and describes everyone.

import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY, TICK_SECONDS, WORLD_SCHEMA, simTimeAt, type AnySimEvent } from "@vch/shared-types";
import { intensityOf } from "../src/activity.js";
import { createSim } from "../src/index.js";
import { weatherAt } from "../src/weather.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const DAY = SECONDS_PER_DAY / TICK_SECONDS;

describe("the world description", () => {
  it("is the same for the same seed, sampled every 5 minutes for a day", () => {
    const a = createSim({ seed: "4", data });
    const b = createSim({ seed: "4", data });
    for (let i = 0; i < DAY; i++) {
      a.step();
      b.step();
      if (i % 60 === 0) expect(JSON.stringify(a.describe())).toBe(JSON.stringify(b.describe()));
    }
  }, 60000);

  it("never changes the run: describing every tick gives the same event log as never describing", () => {
    const quiet = createSim({ seed: "2", data });
    const watched = createSim({ seed: "2", data });
    const log = (events: AnySimEvent[]) => JSON.stringify(events);
    for (let i = 0; i < DAY; i++) {
      const q = log(quiet.step());
      const w = log(watched.step());
      watched.describe();
      watched.describeRoom("Room5");
      expect(w).toBe(q);
    }
  }, 60000);

  it("gives everyone on the map an activity with a MET, and over a day the activities you'd expect", () => {
    const sim = createSim({ seed: "1", data });
    const seen = new Set<string>();
    for (let i = 0; i < DAY; i++) {
      sim.step();
      if (i % 12 !== 0) continue;
      const d = sim.describe();
      expect(d.schema).toBe(WORLD_SCHEMA);
      expect(d.people.map((p) => p.personId)).toEqual(sim.world.order.filter((id) => sim.world.people.get(id)!.onMap));
      for (const p of d.people) {
        expect(p.met).toBeGreaterThan(0);
        expect(p.intensity).toBe(intensityOf(p.met));
        seen.add(`${p.kind === "resident" ? "resident" : "other"}:${p.activity}`);
      }
    }
    for (const a of ["resident:sleeping", "resident:lying", "resident:sitting", "resident:walking", "resident:eating", "resident:receiving_care", "resident:toileting", "other:walking", "other:personal_care", "other:med_round", "other:desk_work", "other:handover", "other:on_break", "other:serving", "other:visiting"]) expect(seen).toContain(a);
  }, 60000);

  it("describes a room: its doors, windows and who is there", () => {
    const sim = createSim({ seed: "1", data });
    for (let i = 0; i < 12 * 60 * 2; i++) sim.step(); // 08:00
    const room = sim.describeRoom("Room5")!;
    expect(room.doors.map((d) => d.doorId).sort()).toEqual(["D_Ensuite5", "D_Room5"]);
    expect(room.windows.map((w) => w.windowId)).toEqual(["Window_Room5"]);
    expect(room.people.every((p) => p.roomId === "Room5" || p.roomId === "Ensuite5")).toBe(true);
    expect(sim.describeRoom("Nowhere")).toBeNull();
  });
});

describe("the weather", () => {
  const weather = data.weather!;

  it("follows the sim's calendar date and hour", () => {
    expect(weatherAt(weather, simTimeAt("2026-11-03", "08:30")).time).toBe("2025-11-03T08:00");
    expect(weatherAt(weather, simTimeAt("2027-05-04", "14:00")).time).toBe("2026-05-04T14:00");
  });

  it("wraps round after a year, and uses 28 February for the 29th", () => {
    expect(weatherAt(weather, simTimeAt("2027-11-03", "08:00")).time).toBe("2025-11-03T08:00");
    expect(weatherAt(weather, simTimeAt("2028-02-29", "13:00")).time).toBe("2026-02-28T13:00");
  });
});

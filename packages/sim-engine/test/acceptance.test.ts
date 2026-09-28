// Phase 1 acceptance (docs/workstreams/phase-1-rules-mvp/spec.md "Acceptance"). One sim day,
// Tue 06:00 to Wed 06:00, headless and unpaced on seed 1, plus the visitor targets across seeds
// 1 to 8 and determinism. The fall golden tests live in golden.test.ts.

import { describe, expect, it } from "vitest";
import { TICK_SECONDS, timeOfDay, weekday, type AnySimEvent, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { checkInvariants, checkServiceTargets, createSim } from "../src/index.js";
import { isMedsTrained } from "../src/meds.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const HOUR = 3600 / TICK_SECONDS;
const residents = data.residents.map((r) => r.id).sort();

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

describe("acceptance: one day on seed 1", () => {
  const sim = createSim({ seed: "1", data });
  const events: AnySimEvent[] = [];
  const hard: string[] = [];
  const service: string[] = [];
  const floorDuringHandover: boolean[] = [];
  for (let i = 0; i < 24 * HOUR; i++) {
    events.push(...sim.step());
    for (const v of checkInvariants(sim.world)) hard.push(`${v.rule}: ${v.details}`);
    for (const b of checkServiceTargets(sim.world)) service.push(`${b.target}: ${b.details}`);
    const handover = [...sim.world.tasks.values()].find((t) => t.kind === "handover" && t.startedT !== null);
    if (handover) {
      const cover = sim.world.people.get(String(handover.data.cover))!;
      floorDuringHandover.push(cover.roomId !== "StaffRoom");
    }
  }

  it("has zero hard safety violations and zero service breaches", () => {
    expect(hard.slice(0, 5)).toEqual([]);
    expect(service.slice(0, 5)).toEqual([]);
    expect(ofType(events, "invariant.violated")).toEqual([]);
    expect(ofType(events, "sla.breached")).toEqual([]);
  });

  it("holds all three handovers, with a carer on the floor during each", () => {
    expect(ofType(events, "handover.completed")).toHaveLength(3);
    expect(floorDuringHandover.length).toBeGreaterThan(0);
    expect(floorDuringHandover.every(Boolean)).toBe(true);
  });

  it("completes four med rounds, the 21:00 one by a meds-trained carer", () => {
    const rounds = ofType(events, "med_round.completed");
    expect(rounds.map((r) => r.payload.round)).toEqual(["08:00", "13:00", "17:00", "21:00"]);
    const nine = rounds.find((r) => r.payload.round === "21:00")!;
    expect(isMedsTrained(sim.world.people.get(nine.payload.staffId)!)).toBe(true);
    expect(ofType(events, "med.administered")).toHaveLength(24);
  });

  it("serves three meals and gives everyone morning personal care", () => {
    for (const meal of ["breakfast", "lunch", "supper"] as const) {
      expect(ofType(events, "meal.served").filter((e) => e.payload.meal === meal).map((e) => e.payload.residentId).sort(), meal).toEqual(residents);
    }
    expect(ofType(events, "care.personal_care_done").filter((e) => e.payload.period === "morning").map((e) => e.payload.residentId).sort()).toEqual(residents);
  });

  it("always moves Raj with two staff", () => {
    const raj = ofType(events, "resident.transferred").filter((e) => e.payload.residentId === "res_raj");
    expect(raj.length).toBeGreaterThanOrEqual(2); // up in the morning, to bed at night
    for (const t of raj) expect(t.payload.staffIds).toHaveLength(2);
    const rajCare = ofType(events, "task.assigned").filter((e) => e.actors.includes("res_raj") && e.payload.staffIds.length > 0);
    for (const a of rajCare.filter((e) => e.payload.kind === "assist" || e.payload.kind === "care")) {
      const task = ofType(events, "task.completed").find((c) => c.payload.taskId === a.payload.taskId);
      if (task && /morning|bedtime|reposition/.test(task.payload.kind)) expect(a.payload.staffIds).toHaveLength(2);
    }
  });

  it("checks everyone at night at their care-plan interval (bedside checks logged)", () => {
    const night = ofType(events, "resident.checked").filter((e) => timeOfDay(e.t) >= 21.5 * 3600 || timeOfDay(e.t) < 7 * 3600);
    for (const id of residents) expect(night.some((e) => e.payload.residentId === id), id).toBe(true);
  });

  it("gives the same seed a byte-identical event log", () => {
    const again = createSim({ seed: "1", data });
    const second: AnySimEvent[] = [];
    for (let i = 0; i < 24 * HOUR; i++) second.push(...again.step());
    expect(JSON.stringify(second)).toBe(JSON.stringify(events));
  });
});

describe("acceptance: visitors across seeds 1 to 8 (a week each)", () => {
  const weekdayPeaks: number[] = [];
  const sundayPeaks: number[] = [];
  const visitsPerResident: Map<string, number>[] = [];
  for (const seed of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
    const sim = createSim({ seed, data });
    const peaks = new Map<number, number>();
    const visits = new Map<string, number>();
    for (let i = 0; i < 7 * 24 * HOUR; i++) {
      for (const e of sim.step()) if (e.type === "visit.started") visits.set(e.payload.residentId, (visits.get(e.payload.residentId) ?? 0) + 1);
      const tod = timeOfDay(sim.t);
      if (sim.t % 60 === 0 && tod >= 14.5 * 3600 && tod <= 16.5 * 3600) {
        const day = Math.floor(sim.t / 86400);
        const onSite = [...sim.world.people.values()].filter((p) => p.visitor && p.onMap).length;
        peaks.set(day, Math.max(peaks.get(day) ?? 0, onSite));
      }
    }
    for (const [day, peak] of peaks) {
      const name = weekday(day * 86400);
      if (name === "Sun") sundayPeaks.push(peak);
      else if (name !== "Sat") weekdayPeaks.push(peak);
    }
    visitsPerResident.push(visits);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it("has a weekday mid-afternoon peak averaging 2 to 4 visitors", () => {
    expect(mean(weekdayPeaks)).toBeGreaterThanOrEqual(2);
    expect(mean(weekdayPeaks)).toBeLessThanOrEqual(4);
  });

  it("has a Sunday mid-afternoon peak averaging 4 to 8 visitors", () => {
    expect(mean(sundayPeaks)).toBeGreaterThanOrEqual(4);
    expect(mean(sundayPeaks)).toBeLessThanOrEqual(8);
  });

  it("gives every resident except Arthur at least 2 visits a week, on every seed", () => {
    visitsPerResident.forEach((visits, i) => {
      for (const id of residents.filter((r) => r !== "res_arthur")) expect(visits.get(id) ?? 0, `seed ${i + 1} ${id}`).toBeGreaterThanOrEqual(2);
    });
  });
});

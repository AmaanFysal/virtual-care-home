import { describe, expect, it } from "vitest";
import { TICK_SECONDS, type AnySimEvent, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { createSim, type Sim } from "../src/index.js";
import { nextCoverT } from "../src/nightcover.js";
import { createAssist } from "../src/tasks.js";
import { markChecked } from "../src/trees.js";
import { placeAt } from "../src/world/movement.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const HOUR = 3600 / TICK_SECONDS;
const START = 108000; // Tue 06:00
const DAY = 86400;

function run(sim: Sim, hours: number): AnySimEvent[] {
  const all: AnySimEvent[] = [];
  for (let i = 0; i < hours * HOUR; i++) all.push(...sim.step());
  return all;
}

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

const hhmm = (t: number) => {
  const s = t % DAY;
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
};

const residents = data.residents.map((r) => r.id);
const upAndAbout = data.residents.filter((r) => !r.care.bed_bound).map((r) => r.id);

describe("the care day (seed 1, Tue 06:00 to Wed 06:00)", () => {
  const sim = createSim({ seed: "1", data });
  const events = run(sim, 24);

  it("gives everyone morning care by 10:30 and gets them up (Raj by hoist)", () => {
    const morning = ofType(events, "care.personal_care_done").filter((e) => e.payload.period === "morning");
    expect(morning.map((e) => e.payload.residentId).sort()).toEqual([...residents].sort());
    for (const e of morning) expect(e.t).toBeLessThanOrEqual(START + 4.5 * 3600);
    expect(ofType(events, "resident.got_up").map((e) => e.payload.residentId).sort()).toEqual([...upAndAbout].sort());
    const raj = ofType(events, "resident.transferred").find((e) => e.payload.residentId === "res_raj" && e.payload.to === "chair")!;
    expect(raj.payload).toMatchObject({ method: "hoist" });
    expect(raj.payload.staffIds).toHaveLength(2);
  });

  it("serves three meals to everyone and charts intake for Peggy, Win and Dennis", () => {
    const meals = ofType(events, "meal.served");
    for (const meal of ["breakfast", "lunch", "supper"] as const) {
      expect(meals.filter((m) => m.payload.meal === meal).map((m) => m.payload.residentId).sort(), meal).toEqual([...residents].sort());
    }
    const charted = new Set(ofType(events, "intake.recorded").map((e) => e.payload.residentId));
    expect([...charted].sort()).toEqual(["res_dennis", "res_peggy", "res_win"]);
  });

  it("runs drinks rounds at 10:30, 15:00 and 20:00", () => {
    const rounds = ofType(events, "task.created").filter((e) => e.payload.kind === "round").map((e) => hhmm(e.t));
    expect(rounds).toEqual(["10:30", "15:00", "20:00"]);
  });

  it("puts everyone who got up back to bed at their bedtime", () => {
    const bed = ofType(events, "resident.went_to_bed");
    expect(bed.map((e) => e.payload.residentId).sort()).toEqual([...upAndAbout].sort());
    const peggy = bed.find((e) => e.payload.residentId === "res_peggy")!;
    expect(peggy.t).toBeGreaterThanOrEqual(START + 15 * 3600); // 21:00
  });

  it("turns Dennis every two hours, with fluids and mouth care", () => {
    const turns = ofType(events, "resident.repositioned").filter((e) => e.payload.residentId === "res_dennis");
    expect(turns.length).toBeGreaterThanOrEqual(11);
    // Repositioning is a service target: never more than 2 hours between turns (counted from when each starts).
    expect(ofType(events, "sla.breached").filter((e) => e.payload.target === "reposition")).toEqual([]);
    for (const t of turns) expect(t.payload.staffIds).toHaveLength(2);
    expect(sim.world.people.get("res_dennis")!.resident!.fluidsMlToday).toBeGreaterThan(0);
  });

  it("checks residents at night at their care-plan interval", () => {
    const night = ofType(events, "resident.checked").filter((e) => e.t >= START + 15.5 * 3600);
    for (const id of ["res_peggy", "res_stan", "res_dennis"]) expect(night.some((e) => e.payload.residentId === id), id).toBe(true);
  });

  it("brings the floating night carer for night turns, aligned with Dennis's, so nobody goes unturned", () => {
    const arrived = ofType(events, "second_carer.arrived");
    expect(arrived.length).toBeGreaterThanOrEqual(5);
    for (const a of arrived) expect(a.payload.planned).toBe(true);
    expect(ofType(events, "second_carer.departed").length).toBeGreaterThanOrEqual(arrived.length - 1);
    const nightTurns = ofType(events, "resident.repositioned").filter((e) => e.t >= START + 15 * 3600 && e.t < START + 24 * 3600);
    expect(nightTurns.filter((e) => e.payload.residentId === "res_raj").length).toBeGreaterThanOrEqual(2);
    for (const t of nightTurns) expect(t.payload.staffIds).toHaveLength(2);
    expect(ofType(events, "sla.breached").filter((e) => e.payload.target === "reposition")).toEqual([]);
  });

  it("only lets women do Peggy's personal care, night and day", () => {
    const women = new Set([...data.staff.filter((s) => s.gender === "female").map((s) => s.id), "ext_night_float"]);
    const peggyCare = ofType(events, "task.completed").filter(
      (e) => e.payload.residentId === "res_peggy" && ["care.morning", "care.bedtime", "care.pad_change"].includes(e.payload.kind),
    );
    expect(peggyCare.length).toBeGreaterThanOrEqual(3);
    for (const e of peggyCare) for (const staff of e.actors.filter((a) => a !== "res_peggy")) expect(women.has(staff), staff).toBe(true);
  });

  it("keeps help requests well under 100 a day, mostly toileting", () => {
    const requests = ofType(events, "resident.requested_help");
    expect(requests.length).toBeLessThan(40);
    const counts = new Map<string, number>();
    for (const r of requests) counts.set(r.payload.need, (counts.get(r.payload.need) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]!;
    expect(top[0]).toBe("toileting");
  });
});

describe("out-of-round call-out", () => {
  /** Steps a night until `ready` holds with the floating carer away, and returns the sim at that moment. */
  function nightMomentWhere(ready: (sim: Sim) => boolean): Sim {
    const sim = createSim({ seed: "1", data });
    run(sim, 16.5); // 22:30
    for (let i = 0; i < 8 * HOUR; i++) {
      sim.step();
      if (sim.t % 60 === 0 && sim.world.float.status === "off" && ready(sim)) return sim;
    }
    throw new Error("no such moment");
  }

  it("calls the floating carer for urgent two-person care when the next round is too far off", () => {
    const sim = nightMomentWhere((s) => nextCoverT(s.world, s.t) - s.t > 45 * 60);
    const w = sim.world;
    const task = createAssist(w, w.people.get("res_raj")!, "toileting");
    expect(task.deadlineT! - task.createdT).toBe(30 * 60); // call-out
    const events = run(sim, 0.75);
    const called = ofType(events, "second_carer.called");
    expect(called).toHaveLength(1);
    expect(called[0]!.payload).toMatchObject({ outOfRound: true, residentIds: ["res_raj"] });
    expect(ofType(events, "second_carer.arrived")[0]!.payload.planned).toBe(false);
    const started = ofType(events, "task.started").find((e) => e.payload.taskId === task.id)!;
    expect(started.t - task.createdT).toBeLessThanOrEqual(30 * 60);
    expect(w.metrics.floatCallouts).toBe(1);
  });

  it("waits for the next round instead when it is within 30 minutes", () => {
    const sim = nightMomentWhere((s) => nextCoverT(s.world, s.t) - s.t <= 25 * 60);
    const cover = nextCoverT(sim.world, sim.t);
    const task = createAssist(sim.world, sim.world.people.get("res_raj")!, "toileting");
    expect(task.deadlineT).toBe(cover + 20 * 60); // the round + 20 minutes
    const events = run(sim, 1);
    expect(ofType(events, "second_carer.called")).toEqual([]);
    const started = ofType(events, "task.started").find((e) => e.payload.taskId === task.id);
    expect(started, "started").toBeDefined();
    expect(started!.t).toBeLessThanOrEqual(task.deadlineT!);
  });
});

describe("no deadlocks or rule breaks across seeds", () => {
  it.each(["2", "3", "4"])("seed %s runs a week with no hard violations and no service breaches", (seed) => {
    const events = run(createSim({ seed, data }), 24 * 7);
    expect(ofType(events, "invariant.violated").map((e) => `${hhmm(e.t)} ${e.payload.rule} ${e.payload.details}`)).toEqual([]);
    expect(ofType(events, "sla.breached").map((e) => `${hhmm(e.t)} ${e.payload.target} ${e.payload.details}`)).toEqual([]);
  });
});

describe("checks (bedside at night and for Dennis; observation by day)", () => {
  it("logs night checks and Dennis's checks as bedside checks", () => {
    const events = run(createSim({ seed: "1", data }), 24);
    const checks = ofType(events, "resident.checked");
    const night = checks.filter((e) => e.t >= START + 15.5 * 3600); // from 21:30
    for (const id of residents) expect(night.some((e) => e.payload.residentId === id), id).toBe(true);
    // Dennis is only ever checked at the bedside, so every hour of the day has one logged.
    const dennis = checks.filter((e) => e.payload.residentId === "res_dennis").map((e) => e.t).sort((a, b) => a - b);
    for (let i = 1; i < dennis.length; i++) expect(dennis[i]! - dennis[i - 1]!).toBeLessThanOrEqual(3600);
  });

  it("doesn't count a carer across the room at night, or watching Dennis from across the room by day", () => {
    const sim = createSim({ seed: "1", data });
    const w = sim.world;
    const dennis = w.people.get("res_dennis")!;
    const stan = w.people.get("res_stan")!;
    const florin = w.people.get("stf_florin")!;
    run(sim, 17); // 23:00
    placeAt(w, florin, "Room2.BedC.Side"); // at Stan's bed, 2.5 m from Dennis
    const before = dennis.resident!.lastCheckedT;
    markChecked(w, dennis, [florin], true);
    expect(dennis.resident!.lastCheckedT).toBe(before); // too far at night
    markChecked(w, stan, [florin], true);
    expect(stan.resident!.lastCheckedT).toBe(w.t); // at the bedside
  });
});

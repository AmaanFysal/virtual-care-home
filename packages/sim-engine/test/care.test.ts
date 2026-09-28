import { describe, expect, it } from "vitest";
import { TICK_SECONDS, type AnySimEvent, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { createSim, type Sim } from "../src/index.js";
import { createAssist } from "../src/tasks.js";
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
    for (let i = 1; i < turns.length; i++) expect(turns[i]!.t - turns[i - 1]!.t).toBeLessThanOrEqual(2.5 * 3600);
    for (const t of turns) expect(t.payload.staffIds).toHaveLength(2);
    expect(sim.world.people.get("res_dennis")!.resident!.fluidsMlToday).toBeGreaterThan(0);
  });

  it("checks residents at night at their care-plan interval", () => {
    const night = ofType(events, "resident.checked").filter((e) => e.t >= START + 15.5 * 3600);
    for (const id of ["res_peggy", "res_stan", "res_dennis"]) expect(night.some((e) => e.payload.residentId === id), id).toBe(true);
  });

  it("sends the floating night carer on all five rounds, turning Raj at 22:00 and 02:00", () => {
    const arrived = ofType(events, "second_carer.arrived");
    expect(arrived.map((e) => hhmm(e.t).slice(0, 2))).toEqual(["22", "00", "02", "04", "06"]);
    for (const a of arrived) expect(a.payload.planned).toBe(true);
    expect(ofType(events, "second_carer.departed")).toHaveLength(4); // still on the 06:00 round when the day ends
    const rajTurns = ofType(events, "resident.repositioned").filter((e) => e.payload.residentId === "res_raj").map((e) => hhmm(e.t).slice(0, 2));
    expect(rajTurns).toEqual(["22", "02"]);
    for (const t of ofType(events, "resident.repositioned").filter((e) => e.payload.residentId === "res_raj")) {
      expect(t.payload.staffIds).toContain("ext_night_float");
    }
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
  it("calls the floating carer for urgent two-person care when the next round is too far off", () => {
    const sim = createSim({ seed: "1", data });
    run(sim, 17); // to 23:00, after the 22:00 round has gone
    const w = sim.world;
    expect(w.float.status).toBe("off");
    const raj = w.people.get("res_raj")!;
    const task = createAssist(w, raj, "toileting");
    expect(task.deadlineT! - task.createdT).toBe(30 * 60); // next round is an hour away: call-out
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
    const sim = createSim({ seed: "1", data });
    run(sim, 17.75); // 23:45; the 00:00 round is 15 minutes away
    const task = createAssist(sim.world, sim.world.people.get("res_raj")!, "toileting");
    expect(task.deadlineT).toBe(START + 18 * 3600 + 20 * 60); // round + 20 min
    const events = run(sim, 0.75);
    expect(ofType(events, "second_carer.called")).toEqual([]);
    expect(ofType(events, "task.started").some((e) => e.payload.taskId === task.id)).toBe(true);
  });
});

describe("no deadlocks or rule breaks across seeds", () => {
  it.each(["2", "3", "4"])("seed %s runs a week with no invariant violations", (seed) => {
    const events = run(createSim({ seed, data }), 24 * 7);
    expect(ofType(events, "invariant.violated").map((e) => `${hhmm(e.t)} ${e.payload.rule} ${e.payload.details}`)).toEqual([]);
  });
});

// Illness, hospital, end of life and admissions (docs/10, sub-milestone c). The admission tests
// use the reviewed card (a draft copy checks a draft can't move in).

import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY, TICK_SECONDS, formatSimTime, type AdmissionCard, type AnySimEvent, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { checkInvariants, createRng, createSim, planRandomDay, residentRisk, validateData, type PlanMemory, type Sim } from "../src/index.js";
import { applyOverride, leaveForHospital } from "../src/health.js";
import type { Task } from "../src/state.js";
import { loadAdmissions, loadDirectorConfig, loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const config = loadDirectorConfig();
const reviewed: AdmissionCard[] = loadAdmissions();
const HOUR = 3600 / TICK_SECONDS;
const DAY = 24 * HOUR;

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

interface Run {
  sim: Sim;
  events: AnySimEvent[];
  hard: string[];
  /** Minute by minute for one resident: room, whether they're in bed. */
  track: { t: number; roomId: string | null; inBed: boolean; onMap: boolean }[];
}

function run(inputs: { atHours: number; type: "resident_illness" | "end_of_life_start" | "admission" | "inject_fall"; payload: object }[], days: number, watch: string, opts: { deaths?: boolean; admissionAfterDeath?: string } = {}): Run {
  const sim = createSim({ seed: "1", data, config, admissions: reviewed, ...(opts.deaths === false ? { deaths: false } : {}) });
  inputs.forEach((x, i) => sim.enqueue({ seq: i + 1, applyTick: Math.round(x.atHours * HOUR), type: x.type, payload: x.payload as never, source: "user" }));
  const events: AnySimEvent[] = [];
  const hard: string[] = [];
  const track: Run["track"] = [];
  let admitQueued = false;
  for (let i = 0; i < days * DAY; i++) {
    events.push(...sim.step());
    for (const v of checkInvariants(sim.world)) hard.push(`${formatSimTime(sim.t)} ${v.rule}: ${v.details}`);
    for (const s of staleStaff(sim)) hard.push(`${formatSimTime(sim.t)} stale task: ${s}`);
    const p = sim.world.people.get(watch)!;
    if (sim.t % 60 === 0) track.push({ t: sim.t, roomId: p.roomId, inBed: !!p.resident?.inBed, onMap: p.onMap });
    if (opts.admissionAfterDeath && !admitQueued && p.resident?.away === "died") {
      sim.enqueue({ seq: 99, applyTick: sim.tick + 3 * HOUR, type: "admission", payload: { cardId: opts.admissionAfterDeath }, source: "user" });
      admitQueued = true;
    }
  }
  return { sim, events, hard, track };
}

/** Staff holding a task that no longer exists (they'd stand still for the rest of the shift). */
function staleStaff(sim: Sim): string[] {
  return [...sim.world.people.values()].filter((p) => p.staff?.taskId && !sim.world.tasks.has(p.staff.taskId)).map((p) => `${p.id} on ${p.staff!.taskId}`);
}

const mine = <K extends keyof EventPayloads>(r: Run, type: K, id: string) => ofType(r.events, type).filter((e) => (e.payload as { residentId?: string }).residentId === id);

describe("a mild illness", () => {
  const r = run([{ atHours: 4, type: "resident_illness", payload: { residentId: "res_arthur", kind: "uti", severity: "mild" } }], 9, "res_arthur");
  const started = mine(r, "illness.started", "res_arthur")[0]!;
  const recovered = mine(r, "illness.recovered", "res_arthur")[0]!;

  it("lasts 3 to 7 days, in their room (no Lounge), with 0 hard violations", () => {
    const days = (recovered.t - started.t) / SECONDS_PER_DAY;
    expect(days).toBeGreaterThanOrEqual(3);
    expect(days).toBeLessThanOrEqual(7);
    for (const m of r.track) if (m.t > started.t + 30 * 60 && m.t < recovered.t) expect(m.roomId, formatSimTime(m.t)).not.toBe("Lounge");
    expect(r.hard).toEqual([]);
  });

  it("brings checks at least hourly and a drink at the contacts while they're awake", () => {
    const checks = ofType(r.events, "sla.breached").filter((b) => b.payload.target === "resident_check" && b.payload.residentId === "res_arthur" && b.t > started.t && b.t < recovered.t);
    expect(checks).toEqual([]);
    const drinks = ofType(r.events, "drink.served").filter((d) => d.payload.residentId === "res_arthur" && d.payload.round === "top_up" && d.t > started.t && d.t < recovered.t);
    expect(drinks.length).toBeGreaterThan(10);
  });
});

describe("a severe illness", () => {
  const r = run([{ atHours: 4, type: "resident_illness", payload: { residentId: "res_win", kind: "chest_infection", severity: "severe" } }], 30, "res_win");

  it("gets the GP within 1 to 4 hours, then an ambulance, and a stay of 5 to 12 days", () => {
    const started = mine(r, "illness.started", "res_win")[0]!;
    const gp = mine(r, "gp.consulted", "res_win")[0]!;
    expect((gp.t - started.t) / 3600).toBeGreaterThanOrEqual(1);
    expect((gp.t - started.t) / 3600).toBeLessThanOrEqual(4);
    expect(mine(r, "ambulance.called", "res_win")[0]!.payload.cause).toBe("chest_infection");
    const conveyed = mine(r, "resident.conveyed_to_hospital", "res_win")[0]!;
    const back = mine(r, "resident.returned_from_hospital", "res_win")[0]!;
    expect(conveyed.payload.cause).toBe("chest_infection");
    expect(back.payload).toMatchObject({ cause: "chest_infection" });
    const days = (back.t - conveyed.t) / SECONDS_PER_DAY;
    expect(days).toBeGreaterThan(4);
    expect(days).toBeLessThan(13);
    expect(mine(r, "family.informed", "res_win").some((f) => /hospital/.test(f.payload.reason))).toBe(true);
    expect(r.hard).toEqual([]);
  });

  it("comes back with care changes logged, undone two weeks later", () => {
    const changes = mine(r, "resident.care_changed", "res_win");
    expect(changes[0]!.payload.reason).toBe("back from hospital (chest infection)");
    expect(changes[0]!.payload.changes.join(" ")).toMatch(/slower.*falls risk medium to high/);
    expect(changes[1]!.payload.reason).toMatch(/: ended$/);
    expect(changes[1]!.t - changes[0]!.t).toBeGreaterThanOrEqual(14 * SECONDS_PER_DAY);
    expect(changes[1]!.t - changes[0]!.t).toBeLessThan(14 * SECONDS_PER_DAY + 60);
    expect(r.sim.world.people.get("res_win")!.resident!.data.mobility.falls_risk).toBe("medium");
  });
});

describe("leaving mid-task", () => {
  it("frees whoever was working with them when a resident leaves for hospital", () => {
    const sim = createSim({ seed: "1", data, config, admissions: reviewed });
    // Run until a carer is on the way to (or doing) something for a resident, then they leave.
    let task: Task | undefined;
    while (!task) {
      sim.step();
      task = [...sim.world.tasks.values()].find((t) => t.status === "active" && t.assigned.length > 0 && t.kind !== "fall" && sim.world.people.get(t.residentId ?? "")?.resident);
    }
    const staff = [...task.assigned];
    leaveForHospital(sim.world, sim.world.people.get(task.residentId!)!, "uti");
    expect(sim.world.tasks.has(task.id)).toBe(false);
    for (const id of staff) expect(sim.world.people.get(id)!.staff!.taskId).toBeNull();
    for (let i = 0; i < HOUR; i++) {
      sim.step();
      expect(staleStaff(sim)).toEqual([]);
    }
    // Back at work within the hour.
    expect(staff.some((id) => sim.world.people.get(id)!.staff!.taskId !== null)).toBe(true);
  });
});

describe("care changes that overlap", () => {
  it("end in any order: each leaves what the others still apply", () => {
    for (const order of [["a", "b"], ["b", "a"]]) {
      const sim = createSim({ seed: "1", data, config, admissions: reviewed });
      const win = sim.world.people.get("res_win")!;
      const speed = win.speed;
      applyOverride(sim.world, win, "a", { falls_risk_up: true, walk_speed_factor: 0.9, weeks: 2 });
      applyOverride(sim.world, win, "b", { falls_risk_up: true, personal_care_staff: 2, weeks: 1 });
      expect(win.resident!.data.mobility.falls_risk).toBe("high");
      const end = (reason: string) => {
        win.resident!.overrides.find((o) => o.reason === reason)!.untilT = sim.t + 60;
        for (let i = 0; i < 24; i++) sim.step();
      };
      end(order[0]!);
      expect(win.resident!.data.mobility.falls_risk, order.join()).toBe("high");
      expect(win.resident!.data.care.personal_care_staff).toBe(order[0] === "b" ? 1 : 2);
      expect(win.speed).toBeCloseTo(order[0] === "a" ? speed : speed * 0.9, 3);
      end(order[1]!);
      expect(win.resident!.data.mobility.falls_risk).toBe("medium");
      expect(win.resident!.data.care.personal_care_staff).toBe(1);
      expect(win.speed).toBeCloseTo(speed, 3);
    }
  });
});

describe("a serious fall", () => {
  it("means a stay of 11 to 25 days, and lasting changes: slower, a higher falls risk, two staff for personal care", () => {
    const r = run([{ atHours: 4, type: "inject_fall", payload: { residentId: "res_arthur", severity: "serious" } }], 30, "res_arthur");
    const conveyed = mine(r, "resident.conveyed_to_hospital", "res_arthur")[0]!;
    const back = mine(r, "resident.returned_from_hospital", "res_arthur")[0]!;
    expect(conveyed.payload.cause).toBe("serious_fall");
    const days = (back.t - conveyed.t) / SECONDS_PER_DAY;
    expect(days).toBeGreaterThan(10);
    expect(days).toBeLessThan(26);
    const change = mine(r, "resident.care_changed", "res_arthur")[0]!;
    expect(change.payload.untilT).toBeNull();
    const arthur = r.sim.world.people.get("res_arthur")!;
    expect(arthur.resident!.data.care.personal_care_staff).toBe(2);
    expect(arthur.resident!.data.mobility.falls_risk).toBe("high");
    expect(arthur.speed).toBeCloseTo(0.36, 3);
    // The card in the caller's data is untouched.
    expect(data.residents.find((x) => x.id === "res_arthur")!.care.personal_care_staff).toBe(1);
    expect(r.hard).toEqual([]);
  }, 60_000);
});

describe("end of life, death and a new admission", () => {
  const r = run([{ atHours: 4, type: "end_of_life_start", payload: { residentId: "res_peggy", expectedDays: 6 } }], 16, "res_peggy", { admissionAfterDeath: "adm_kamala" });
  const started = mine(r, "end_of_life.started", "res_peggy")[0]!;
  const died = mine(r, "resident.died", "res_peggy")[0]!;

  it("is a decline with hourly checks, every 30 minutes in the last days, the family visiting every day and later, the last days in bed", () => {
    expect(started.payload.expectedDays).toBe(6);
    const checks = ofType(r.events, "sla.breached").filter((b) => b.payload.target === "resident_check" && b.payload.residentId === "res_peggy" && b.t > started.t + HOUR * TICK_SECONDS);
    // Occasional misses (the morning rush) are reported, not failures: at most one every two days.
    expect(checks.length).toBeLessThanOrEqual(started.payload.expectedDays / 2);
    const visits = ofType(r.events, "visit.started").filter((v) => v.payload.residentId === "res_peggy" && v.t > started.t && v.t < died.t);
    const days = new Set(visits.map((v) => Math.floor(v.t / SECONDS_PER_DAY)));
    expect(days.size).toBeGreaterThanOrEqual(4);
    const last = mine(r, "resident.care_changed", "res_peggy").find((c) => c.payload.reason === "end of life: the last days")!;
    // The last days begin once any care in progress is done (a few minutes at most).
    expect(died.t - last.t).toBeGreaterThanOrEqual(3 * SECONDS_PER_DAY - 30 * 60);
    for (const m of r.track) if (m.t > last.t + 60 && m.t < died.t) expect(m.inBed, formatSimTime(m.t)).toBe(true);
    // Checks stepped up for the last days: hourly before, every 30 minutes after.
    expect(last.payload.changes).toContain("checks every 30 min");
    // Her turns start when she's settled in bed, not from a turn she never needed.
    const turnBreaches = ofType(r.events, "sla.breached").filter((b) => b.payload.target === "reposition" && b.payload.residentId === "res_peggy");
    expect(turnBreaches.filter((b) => b.t - last.t < 3 * 3600)).toEqual([]);
    const checked = mine(r, "resident.checked", "res_peggy");
    const perDay = (from: number, to: number) => (checked.filter((c) => c.t >= from && c.t < to).length * SECONDS_PER_DAY) / (to - from);
    expect(perDay(started.t + SECONDS_PER_DAY, last.t)).toBeGreaterThanOrEqual(24);
    expect(perDay(last.t, died.t)).toBeGreaterThanOrEqual(48);
    expect(perDay(last.t, died.t)).toBeGreaterThan(1.5 * perDay(started.t + SECONDS_PER_DAY, last.t));
  });

  it("records the death quietly: the family told, the room left empty, her visitors no longer come", () => {
    expect(died.t - started.t).toBeGreaterThanOrEqual(6 * SECONDS_PER_DAY);
    expect(died.t - started.t).toBeLessThan(6 * SECONDS_PER_DAY + 2 * 3600);
    expect(mine(r, "family.informed", "res_peggy").some((f) => f.payload.reason === "died peacefully" && f.t === died.t)).toBe(true);
    expect(mine(r, "cqc.notification_flagged", "res_peggy").map((c) => c.payload.regulation)).toEqual(["Registration Regulations 2009, Regulation 16"]);
    const peggy = r.sim.world.people.get("res_peggy")!;
    expect(peggy.onMap).toBe(false);
    expect(peggy.resident!.away).toBe("died");
    expect([...r.sim.world.tasks.values()].some((t) => t.residentId === "res_peggy")).toBe(false);
    const hersAfter = ofType(r.events, "visit.planned").filter((v) => v.payload.residentId === "res_peggy" && v.t > died.t + SECONDS_PER_DAY);
    expect(hersAfter).toEqual([]);
    expect(r.hard).toEqual([]);
  });

  it("then a reviewed card moves into her empty room, with a bedside chair, and is cared for; her family visit", () => {
    const admitted = ofType(r.events, "resident.admitted")[0]!;
    expect(admitted.payload).toMatchObject({ residentId: "res_kamala", roomId: "Room5", cardId: "adm_kamala" });
    const kamala = r.sim.world.people.get("res_kamala")!;
    expect(kamala.onMap).toBe(true);
    expect(kamala.resident!.data.room).toBe("Room5.Bed");
    expect(r.sim.world.points.has("Room5.Bed.Chair")).toBe(true);
    expect(mine(r, "meal.served", "res_kamala").length).toBeGreaterThan(3);
    expect(mine(r, "resident.checked", "res_kamala").length).toBeGreaterThan(5);
    expect(r.sim.world.people.get("vis_hema")!.visitor).toBeTruthy();
    expect(ofType(r.events, "visit.planned").some((v) => v.payload.residentId === "res_kamala")).toBe(true);
    // Handovers include her, and nobody who has died.
    const handover = ofType(r.events, "handover.completed").filter((h) => h.t > admitted.t)[0]!;
    expect(handover.payload.summary.map((s) => s.residentId)).toContain("res_kamala");
    expect(handover.payload.summary.map((s) => s.residentId)).not.toContain("res_peggy");
    // The caller's data is untouched.
    expect(data.residents.some((x) => x.id === "res_kamala")).toBe(false);
  });
});

describe("the deaths switch", () => {
  it("off: an end-of-life start is skipped", () => {
    const r = run([{ atHours: 4, type: "end_of_life_start", payload: { residentId: "res_dennis", expectedDays: 3 } }], 1, "res_dennis", { deaths: false });
    expect(ofType(r.events, "input.skipped").map((e) => e.payload.reason)).toEqual(["deaths and end-of-life decline are off for this run"]);
    expect(ofType(r.events, "end_of_life.started")).toEqual([]);
  });

  it("off: the director plans no end-of-life decline", () => {
    const rng = createRng("deaths/director");
    const memory: PlanMemory = { dayTypes: new Map(), majorTs: [] };
    let planned = 0;
    for (let day = 1; day <= 3650; day++) {
      const plan = planRandomDay(config, rng, memory, day, day * SECONDS_PER_DAY - 1, [], data.residents.map(residentRisk), { deaths: false });
      planned += plan.planned.filter((e) => e.type === "end_of_life_start").length;
    }
    expect(planned).toBe(0);
  });
});

describe("admission cards", () => {
  it("validate as residents in a freed room (a card is used only once reviewed)", () => {
    for (const card of loadAdmissions()) {
      const freed = data.residents.find((x) => x.id === "res_peggy")!;
      const residents = [...data.residents.filter((x) => x.id !== "res_peggy"), { ...card.resident, room: freed.room }];
      const errors = validateData({ ...data, residents, visitors: [...data.visitors, ...card.visitors] }).filter((e) => !e.includes("res_peggy") && !/bedside chair/.test(e));
      expect([card.id, errors]).toEqual([card.id, []]);
      expect(["draft", "reviewed"]).toContain(card.status);
    }
  });

  it("can move into any room, set up for them: a chair by the bed, and no wheelchair spot left from Raj", () => {
    for (const leaving of data.residents) {
      const sim = createSim({ seed: "1", data, config, admissions: reviewed });
      // As if they had died (docs/10): off the map, the room empty.
      const p = sim.world.people.get(leaving.id)!;
      Object.assign(p, { onMap: false, roomId: null, atPoint: null, move: null });
      p.resident!.away = "died";
      for (const t of [...sim.world.tasks.values()]) if (t.residentId === leaving.id) sim.world.tasks.delete(t.id);
      sim.enqueue({ seq: 1, applyTick: 2, type: "admission", payload: { cardId: "adm_kamala" }, source: "user" });
      const events: AnySimEvent[] = [];
      const hard: string[] = [];
      for (let i = 0; i < 6 * HOUR; i++) {
        events.push(...sim.step());
        for (const v of checkInvariants(sim.world)) hard.push(`${v.rule}: ${v.details}`);
      }
      expect([leaving.id, ofType(events, "input.skipped").map((e) => e.payload.reason)]).toEqual([leaving.id, []]);
      const bed = leaving.room;
      expect(sim.world.people.get("res_kamala")!.resident!.data.room).toBe(bed);
      expect(sim.world.points.has(`${bed}.Chair`)).toBe(true);
      expect(sim.world.points.has(`${bed}.Wheelchair`)).toBe(false);
      expect(sim.world.data.floorplan.furniture.filter((f) => f.id === `${bed}.chair`)).toHaveLength(1);
      expect(mine({ sim, events, hard, track: [] }, "resident.checked", "res_kamala").length).toBeGreaterThan(2);
      expect([leaving.id, hard]).toEqual([leaving.id, []]);
    }
    // The caller's floor plan is untouched.
    expect(data.floorplan.points.some((x) => x.id === "Room3.Bed.Wheelchair")).toBe(true);
  });

  it("a draft card can't move in", () => {
    const sim = createSim({ seed: "1", data, config, admissions: loadAdmissions().map((c) => ({ ...c, status: "draft" })) });
    sim.enqueue({ seq: 1, applyTick: 2, type: "admission", payload: { cardId: "adm_kamala" }, source: "user" });
    const events: AnySimEvent[] = [];
    for (let i = 0; i < 5; i++) events.push(...sim.step());
    expect(ofType(events, "input.skipped")[0]!.payload.reason).toMatch(/hasn't been reviewed/);
  });
});

describe("realised rates", () => {
  it("admissions (illness plus serious falls) and deaths stay within 10% of their base rates over 100 years", () => {
    const rng = createRng("health-rates/director");
    const memory: PlanMemory = { dayTypes: new Map(), majorTs: [] };
    let severe = 0;
    let serious = 0;
    let eol = 0;
    const years = 100;
    for (let day = 1; day <= years * 365; day++) {
      const plan = planRandomDay(config, rng, memory, day, day * SECONDS_PER_DAY - 1, [], data.residents.map(residentRisk));
      memory.dayTypes.set(day, plan.dayType);
      memory.majorTs = memory.majorTs.filter((t) => t > (day - 7) * SECONDS_PER_DAY);
      severe += plan.planned.filter((e) => e.type === "resident_illness" && (e.params as { severity: string }).severity === "severe").length;
      serious += plan.planned.filter((e) => e.type === "inject_fall" && (e.params as { severity: string }).severity === "serious").length;
      eol += plan.planned.filter((e) => e.type === "end_of_life_start").length;
    }
    const n = data.residents.length;
    expect(Math.abs((severe + serious) / (config.health.admissions_per_resident_year * n * years) - 1)).toBeLessThan(0.1);
    expect(Math.abs(eol / (config.health.end_of_life.deaths_per_resident_year * n * years) - 1)).toBeLessThan(0.1);
  });
});

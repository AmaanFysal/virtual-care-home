// The scenario director (docs/10), sub-milestone (a): scripted scenarios replayed exactly, the
// sick-call cover rule, pacing caps, realised rates against the base rates, the calendar, and the
// scenario validator. "Director off = main" is in director-off.test.ts.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY, TICK_SECONDS, formatSimTime, simDate, type AnySimEvent, type DirectorConfig, type DirectorSettings, type EventPayloads, type Scenario, type SimEvent } from "@vch/shared-types";
import { checkInvariants, createRng, createSim, planRandomDay, residentRisk, validateInput, validateScenario, type PlanMemory, type RosterEntry } from "../src/index.js";
import { loadDirectorConfig, loadScenario, loadWorldData, scenarioIds } from "../tools/load-data.js";

const data = loadWorldData();
const config = loadDirectorConfig();
const HOUR = 3600 / TICK_SECONDS;
const DAY = 24 * HOUR;

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

interface Run {
  events: AnySimEvent[];
  hard: string[];
  hash: string;
}

function run(seed: string, ticks: number, director?: DirectorSettings, inputs: { at: number; type: "staff_sick" | "shift_no_show"; params: object }[] = []): Run {
  const sim = createSim({ seed, data, ...(director ? { director } : {}) });
  inputs.forEach((input, i) => sim.enqueue({ seq: i + 1, applyTick: input.at, type: input.type, payload: input.params as never, source: "user" }));
  const events: AnySimEvent[] = [];
  const hard: string[] = [];
  const hash = createHash("sha256");
  for (let i = 0; i < ticks; i++) {
    for (const e of sim.step()) {
      events.push(e);
      hash.update(JSON.stringify(e));
    }
    for (const v of checkInvariants(sim.world)) hard.push(`${formatSimTime(sim.t)} ${v.rule}: ${v.details}`);
  }
  return { events, hard, hash: hash.digest("hex") };
}

/** Tick of a clock time `days` after the start day (the run starts Tue 06:00). */
const tickOf = (days: number, clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return ((days * 24 + h! - 6) * 3600 + m! * 60) / TICK_SECONDS;
};
const on = (e: AnySimEvent, weekday: string) => formatSimTime(e.t).startsWith(weekday);

describe("the short-staffed weekend scenario", () => {
  const scenario = loadScenario("short-staffed-weekend");
  const settings: DirectorSettings = { config, random: false, scenario };
  const a = run("1", 7 * DAY, settings);

  it("replays to a byte-identical log", () => {
    expect(run("1", 7 * DAY, settings).hash).toBe(a.hash);
  });

  it("keeps every hard safety rule on every tick", () => {
    expect(a.hard).toEqual([]);
  });

  it("logs every scripted event as planned by the scenario, and applies it with source director", () => {
    const planned = ofType(a.events, "director.planned");
    expect(planned.map((e) => e.payload.inputType)).toEqual(["staff_sick", "shift_no_show", "staff_sick"]);
    expect(planned.every((e) => e.payload.origin === "scenario:short-staffed-weekend")).toBe(true);
    const absent = ofType(a.events, "staff.absent");
    expect(absent.map((e) => [e.payload.staffId.slice(0, 4), e.payload.slot, e.payload.reason, e.source])).toEqual([
      ["stf_", "early.ca", "sick", "director"],
      ["agy_", "night.carer", "no_show", "director"],
      ["stf_", "late.ca", "sick", "director"],
    ]);
  });

  it("covers Tom's Friday early with a late agency carer", () => {
    const booked = ofType(a.events, "rota.cover_booked").find((e) => on(e, "Fri"))!;
    expect(booked.payload).toMatchObject({ slot: "early.ca", forStaffId: "stf_tom", cover: "agency" });
    const started = ofType(a.events, "shift.started").find((e) => e.payload.staffId === booked.payload.staffId)!;
    expect(started.t).toBeGreaterThan(booked.t);
    expect(started.t).toBeGreaterThanOrEqual(booked.t + 60 * 60);
    expect(ofType(a.events, "shift.started").some((e) => e.payload.staffId === "stf_tom" && on(e, "Fri"))).toBe(false);
  });

  it("has the late carer stay on Saturday night only until a carer from the main building arrives (1 to 2 hours), with no evening handover", () => {
    const stay = ofType(a.events, "rota.cover_booked").find((e) => e.payload.cover === "stay_on")!;
    expect(stay.payload.staffId).toBe("stf_shanice");
    const untilT = stay.payload.untilT!;
    const nightStart = ofType(a.events, "shift.started").find((e) => e.payload.staffId === "stf_shanice" && e.payload.shift === "night")!;
    expect(formatSimTime(nightStart.t)).toMatch(/^Sat .* 21:15$/);
    expect((untilT - nightStart.t) / 60).toBeGreaterThanOrEqual(60);
    expect((untilT - nightStart.t) / 60).toBeLessThanOrEqual(120);
    // The cover from the main building takes over the night; Shanice goes home once she's on the floor.
    const cover = ofType(a.events, "rota.cover_booked").find((e) => e.payload.cover === "main_building")!;
    expect(cover.payload.arriveT).toBe(untilT);
    expect(ofType(a.events, "shift.started").some((e) => e.payload.staffId === cover.payload.staffId && e.t === untilT)).toBe(true);
    const home = a.events.find((e) => e.type === "person.departed" && e.actors[0] === "stf_shanice" && e.t > nightStart.t)!;
    expect(home.t).toBeGreaterThanOrEqual(untilT);
    expect(home.t - untilT).toBeLessThan(30 * 60);
    const saturdayEvening = ofType(a.events, "handover.started").filter((e) => on(e, "Sat") && e.t % SECONDS_PER_DAY > 20 * 3600);
    expect(saturdayEvening).toEqual([]);
    // The main-building carer hands over to the Sunday early at 07:00.
    const sunday = ofType(a.events, "handover.started").find((e) => on(e, "Sun") && e.payload.from.includes(cover.payload.staffId));
    expect(sunday).toBeDefined();
  });

  it("covers Aisha's Monday late with a bank carer", () => {
    const booked = ofType(a.events, "rota.cover_booked").find((e) => on(e, "Mon"))!;
    expect(booked.payload).toMatchObject({ slot: "late.ca", forStaffId: "stf_aisha", cover: "bank", staffId: "stf_lucy" });
    expect(ofType(a.events, "shift.started").some((e) => e.payload.staffId === "stf_lucy" && e.payload.slot === "late.ca" && on(e, "Mon"))).toBe(true);
  });
});

describe("the cover rule (manual sick calls, director off)", () => {
  it("covers a shift lead with a meds-trained agency senior, and the RN with an agency nurse", () => {
    const sim = createSim({ seed: "1", data });
    sim.enqueue({ seq: 1, applyTick: tickOf(1, "05:30"), type: "staff_sick", payload: { staffId: "stf_blessing" }, source: "user" });
    sim.enqueue({ seq: 2, applyTick: tickOf(1, "05:30"), type: "staff_sick", payload: { staffId: "stf_maria" }, source: "user" });
    const events: AnySimEvent[] = [];
    for (let i = 0; i < tickOf(1, "06:00"); i++) events.push(...sim.step());
    const booked = ofType(events, "rota.cover_booked");
    expect(booked.map((e) => [e.payload.slot, e.payload.cover])).toEqual([
      ["early.lead", "agency"],
      ["rn_day.nurse", "agency"],
    ]);
    const lead = sim.world.people.get(booked[0]!.payload.staffId)!;
    const nurse = sim.world.people.get(booked[1]!.payload.staffId)!;
    expect(lead.staff!.competencies).toContain("meds_trained");
    expect(nurse.staff!.role).toBe("agency_nurse");
    expect(events.every((e) => e.type !== "staff.absent" || e.source === "user")).toBe(true);
  });

  it("offers bank work only with 11 hours' rest: nobody for Friday's early after Lucy's Thursday late", () => {
    const r = run("1", tickOf(3, "08:00"), undefined, [{ at: tickOf(3, "06:15"), type: "staff_sick", params: { staffId: "stf_tom", cover: "bank" } }]);
    expect(ofType(r.events, "rota.no_cover").map((e) => e.payload)).toEqual([{ slot: "early.ca", shift: "early", forStaffId: "stf_tom", reason: "no bank carer free" }]);
  });

  it("runs a day shift short with no cover and keeps the floor covered", () => {
    const r = run("2", tickOf(2, "06:00"), undefined, [{ at: tickOf(1, "06:15"), type: "staff_sick", params: { staffId: "stf_kasia", cover: "none" } }]);
    expect(ofType(r.events, "rota.no_cover")).toHaveLength(1);
    expect(r.hard).toEqual([]);
    const breaches = ofType(r.events, "sla.breached").filter((e) => e.t < 108000 + SECONDS_PER_DAY + 14.5 * 3600 && e.t > 108000 + SECONDS_PER_DAY + 7 * 3600);
    for (const b of breaches) expect(b.payload.cause).toContain("short-staffed: Kasia off sick (early), no cover");
  });

  it("has the on-call RN come over (about 30 minutes) to give the 21:00 round when a scenario leaves the late lead's slot uncovered", () => {
    const r = run("1", tickOf(1, "00:30"), undefined, [{ at: tickOf(0, "13:00"), type: "staff_sick", params: { staffId: "stf_dave", cover: "none" } }]);
    expect(ofType(r.events, "med_round.no_giver").map((e) => e.payload.round)).toEqual(["21:00"]);
    const called = ofType(r.events, "on_call_rn.called")[0]!;
    expect(called.payload.residentId).toBeNull();
    const arrived = ofType(r.events, "on_call_rn.arrived")[0]!;
    expect((arrived.t - called.t) / 60).toBeGreaterThanOrEqual(25);
    expect((arrived.t - called.t) / 60).toBeLessThanOrEqual(36);
    const done = ofType(r.events, "med_round.completed").find((e) => e.payload.round === "21:00")!;
    expect(done.payload.staffId).toBe("ext_oncall_rn");
    expect(ofType(r.events, "on_call_rn.departed").some((e) => e.t >= done.t)).toBe(true);
    expect(r.hard).toEqual([]);
  });

  it("keeps the floor covered at the 07:00 handover when the floor cover and the RN are both missing", () => {
    const r = run("1", tickOf(2, "09:00"), undefined, [
      { at: tickOf(2, "06:02"), type: "staff_sick", params: { staffId: "stf_tom", cover: "none" } },
      { at: tickOf(2, "06:29"), type: "staff_sick", params: { staffId: "stf_maria", cover: "agency" } },
    ]);
    expect(ofType(r.events, "staff.absent")).toHaveLength(2);
    expect(r.hard).toEqual([]);
  });

  it("logs a sick call for someone already at work as skipped", () => {
    const r = run("1", tickOf(0, "10:00"), undefined, [{ at: tickOf(0, "09:00"), type: "staff_sick", params: { staffId: "stf_blessing" } }]);
    expect(ofType(r.events, "staff.absent")).toEqual([]);
    expect(ofType(r.events, "input.skipped").map((e) => [e.payload.reason, e.source])).toEqual([["already at work", "user"]]);
  });
});

describe("the random director", () => {
  it("plans each day, applies its events with source director, and keeps every hard rule for two weeks", () => {
    const r = run("3", 14 * DAY, { config, random: true });
    expect(r.hard).toEqual([]);
    expect(ofType(r.events, "director.day_planned")).toHaveLength(15);
    for (const e of [...ofType(r.events, "resident.fell"), ...ofType(r.events, "staff.absent")]) expect(e.source).toBe("director");
    expect(ofType(r.events, "director.planned").length).toBeGreaterThan(0);
  }, 60000);
});

describe("pacing caps", () => {
  // Rates turned up far past the real ones, so the caps do the work.
  const loud: DirectorConfig = {
    ...config,
    day_types: { ordinary: { p: 0.2, rate: 20 }, busy: { p: 0.3, rate: 30 }, hard: { p: 0.5, rate: 40 } },
    falls: { ...config.falls, serious_share: 0.5 },
  };
  const residents = data.residents.map(residentRisk);
  const staff = new Map(data.staff.map((s) => [s.id, s.contract.sickness_propensity]));
  const roster = (day: number): RosterEntry[] =>
    (["stf_blessing", "stf_tom", "stf_dave", "stf_aisha", "stf_florin"] as const).map((id, i) => ({
      personId: id,
      slot: ["early.lead", "early.ca", "late.lead", "late.ca", "night.carer"][i]!,
      shift: (["early", "early", "late", "late", "night"] as const)[i]!,
      startT: day * SECONDS_PER_DAY + [7, 7, 14, 14, 21.25][i]! * 3600,
      endT: day * SECONDS_PER_DAY + [14.5, 14.5, 21.5, 21.5, 31.25][i]! * 3600,
      agency: false,
      propensity: staff.get(id)!,
    }));

  it("never break: 2 absences a day, 1 major a day 48 h apart, 2 hard days a week", () => {
    const rng = createRng("caps/director");
    const memory: PlanMemory = { dayTypes: new Map(), majorTs: [] };
    const majors: number[] = [];
    let suppressed = 0;
    for (let day = 1; day <= 730; day++) {
      const plan = planRandomDay(loud, rng, memory, day, day * SECONDS_PER_DAY - 1, roster(day), residents);
      memory.dayTypes.set(day, plan.dayType);
      suppressed += plan.suppressed.length;
      expect(plan.planned.filter((e) => e.type === "staff_sick" || e.type === "shift_no_show").length).toBeLessThanOrEqual(2);
      majors.push(...plan.planned.filter((e) => e.type === "inject_fall" && (e.params as { severity: string }).severity === "serious").map((e) => e.applyT));
      let hard = 0;
      for (let d = day - 6; d <= day; d++) if (memory.dayTypes.get(d) === "hard") hard += 1;
      expect(hard).toBeLessThanOrEqual(2);
    }
    majors.sort((x, y) => x - y);
    for (let i = 1; i < majors.length; i++) expect(majors[i]! - majors[i - 1]!).toBeGreaterThanOrEqual(48 * 3600);
    expect(suppressed).toBeGreaterThan(0);
  });

  it("with the real rates, the realised rates stay within 10% of the base rates", () => {
    const rng = createRng("rates/director");
    const memory: PlanMemory = { dayTypes: new Map(), majorTs: [] };
    let falls = 0;
    let sick = 0;
    let expectedSick = 0;
    const days = 365 * 100;
    for (let day = 1; day <= days; day++) {
      const list = roster(day);
      const winter = config.absence.winter_months.includes(simDate(day * SECONDS_PER_DAY).month) ? config.absence.winter_factor : 1;
      expectedSick += list.reduce((s, a) => s + a.propensity * winter, 0);
      const plan = planRandomDay(config, rng, memory, day, day * SECONDS_PER_DAY - 1, list, residents);
      memory.dayTypes.set(day, plan.dayType);
      memory.majorTs = memory.majorTs.filter((t) => t > (day - 7) * SECONDS_PER_DAY);
      falls += plan.planned.filter((e) => e.type === "inject_fall").length;
      sick += plan.planned.filter((e) => e.type === "staff_sick").length;
    }
    const baseFalls = config.falls.per_resident_year * residents.length * 100;
    expect(Math.abs(falls / baseFalls - 1)).toBeLessThan(0.1);
    expect(Math.abs(sick / expectedSick - 1)).toBeLessThan(0.1);
  });
});

describe("director.json", () => {
  it("has day types that add up and average a rate of about 1, and 24 hour weights", () => {
    const types = Object.values(config.day_types);
    expect(types.reduce((s, d) => s + d.p, 0)).toBeCloseTo(1, 6);
    expect(types.reduce((s, d) => s + d.p * d.rate, 0)).toBeGreaterThan(0.97);
    expect(types.reduce((s, d) => s + d.p * d.rate, 0)).toBeLessThan(1.03);
    expect(config.falls.hour_weights).toHaveLength(24);
  });
});

describe("scenario files", () => {
  it("are all valid", () => {
    for (const id of scenarioIds()) expect([id, validateScenario(loadScenario(id), data)]).toEqual([id, []]);
  });

  it("catch bad events", () => {
    const bad: Scenario = {
      id: "Bad Id",
      name: "",
      description: "",
      random: false,
      events: [
        { day: "Fri", time: "25:00", type: "staff_sick", params: { staffId: "stf_nobody" } },
        { day: "Fry" as never, time: "07:00", type: "inject_fall", params: { residentId: "res_peggy", severity: "bad" as never } },
        { t: 1234, type: "shift_no_show", params: { slot: "early.cook", cover: "maybe" as never } },
        { day: "Mon", time: "07:00", type: "outbreak" as never, params: {} as never },
      ],
    };
    const errors = validateScenario(bad, data);
    for (const text of ["id must be", "name is required", "events[0]: time must be HH:MM", "unknown staff member", "events[1]: day must be", "severity must be", "t must be whole minutes", "slot must be one of", "cover must be one of", 'unknown event type "outbreak"'])
      expect(errors.some((e) => e.includes(text)), text).toBe(true);
    expect(validateInput("inject_fall", { residentId: "res_stan", severity: "minor" }, data)).toEqual([]);
  });
});

describe("the calendar", () => {
  it("matches the Gregorian calendar for five years from the epoch, including 29 Feb 2028", () => {
    const epoch = Date.UTC(2026, 10, 2);
    for (let day = 0; day < 5 * 366; day++) {
      const d = new Date(epoch + day * 86400000);
      expect(simDate(day * SECONDS_PER_DAY)).toEqual({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    }
    expect(formatSimTime(0)).toBe("Mon 02 Nov 00:00");
    expect(formatSimTime(119 * SECONDS_PER_DAY + 7 * 3600 + 30 * 60)).toBe("Mon 01 Mar 07:30");
  });
});

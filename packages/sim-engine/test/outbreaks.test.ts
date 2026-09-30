// Infections and outbreaks (docs/10, sub-milestone b): the routes and how they combine, the two
// outbreak scenarios with their expected outcomes and byte-identical replays, staff going home ill,
// and introductions paced by the director.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY, TICK_SECONDS, formatSimTime, type AnySimEvent, type DirectorSettings, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { checkInvariants, createRng, createSim, planRandomDay, residentRisk, type PlanMemory } from "../src/index.js";
import { combine, routeChances } from "../src/infection.js";
import { loadDirectorConfig, loadScenario, loadWorldData } from "../tools/load-data.js";

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
  /** Minute by minute: who was in the Lounge, and whether an outbreak was on / who was isolated. */
  lounge: { t: number; ids: string[]; outbreak: boolean; isolated: string[] }[];
  shiftsStarted: SimEvent<"shift.started">[];
}

function scenarioRun(id: string, days: number, seed = "1"): Run {
  const director: DirectorSettings = { config, random: false, scenario: loadScenario(id) };
  const sim = createSim({ seed, data, director });
  const events: AnySimEvent[] = [];
  const hard: string[] = [];
  const lounge: Run["lounge"] = [];
  const hash = createHash("sha256");
  for (let i = 0; i < days * DAY; i++) {
    for (const e of sim.step()) {
      events.push(e);
      hash.update(JSON.stringify(e));
    }
    for (const v of checkInvariants(sim.world)) hard.push(`${formatSimTime(sim.t)} ${v.rule}: ${v.details}`);
    if (sim.t % 60 === 0) {
      const people = [...sim.world.people.values()];
      lounge.push({
        t: sim.t,
        ids: people.filter((p) => p.resident && p.onMap && p.roomId === "Lounge").map((p) => p.id),
        outbreak: sim.world.outbreaks.some((o) => o.overT === null),
        isolated: people.filter((p) => p.resident && p.infection?.isolated).map((p) => p.id),
      });
    }
  }
  return { events, hard, hash: hash.digest("hex"), lounge, shiftsStarted: ofType(events, "shift.started") };
}

/** Outcomes every outbreak scenario must show. */
function outbreakOutcomes(r: Run): void {
  expect(r.hard).toEqual([]);
  const declared = ofType(r.events, "outbreak.declared");
  const over = ofType(r.events, "outbreak.over");
  expect(declared.length).toBeGreaterThan(0);
  expect(over.length).toBe(declared.length);
  // Declared at the second case within 48 hours; over exactly 48 hours after the last case.
  const onsets = ofType(r.events, "infection.symptomatic");
  for (const d of declared) {
    const window = onsets.filter((o) => o.payload.disease === d.payload.disease && o.t <= d.t && d.t - o.t <= 48 * 3600);
    expect(window.length).toBeGreaterThanOrEqual(2);
  }
  // Over as UK practice has it (norovirus: 48 hours after the last case is symptom-free; flu: 5 days
  // after the last onset), and never while a case is still ill.
  const recovered = ofType(r.events, "infection.recovered");
  for (const o of over) {
    const mine = (x: { payload: { personId: string; disease: string } }) => o.payload.cases.includes(x.payload.personId) && x.payload.disease === o.payload.disease;
    const lastOnset = Math.max(...onsets.filter(mine).map((x) => x.t));
    const lastRecovery = Math.max(...recovered.filter(mine).map((x) => x.t));
    expect(recovered.filter(mine).length, "every case symptom-free first").toBe(o.payload.cases.length);
    const rule = config.infection.outbreak.end[o.payload.disease];
    const due = rule.after === "onset" ? Math.max(lastOnset + rule.hours * 3600, lastRecovery) : lastRecovery + rule.hours * 3600;
    expect(o.t - due).toBeGreaterThanOrEqual(0);
    expect(o.t - due).toBeLessThan(60);
  }
  // While an outbreak is on (after 30 minutes to walk everyone back): nobody in the Lounge, no session.
  const firstOn = r.lounge.find((m) => m.outbreak)!.t;
  for (const m of r.lounge) if (m.outbreak && m.t - firstOn > 30 * 60 && r.lounge.find((x) => x.t === m.t - 30 * 60)?.outbreak) expect(m.ids, formatSimTime(m.t)).toEqual([]);
  for (const s of ofType(r.events, "activity.started")) expect(r.lounge.find((m) => m.t === s.t)?.outbreak, "session during an outbreak").toBeFalsy();
  // Only essential visits start during an outbreak (Dennis, at the end of his life); the rest are cancelled.
  const onAt = (t: number) => r.lounge.find((m) => m.t === t - (t % 60))?.outbreak;
  for (const v of ofType(r.events, "visit.started")) if (onAt(v.t)) expect(v.payload.residentId).toBe("res_dennis");
  expect(ofType(r.events, "visit.cancelled").length).toBeGreaterThan(0);
  // An isolated resident is never in the Lounge after 30 minutes to walk back.
  for (const m of r.lounge) for (const id of m.isolated) if (m.ids.includes(id)) expect(r.lounge.find((x) => x.t === m.t - 30 * 60)?.isolated ?? [], `${id} ${formatSimTime(m.t)}`).not.toContain(id);
  // The Lounge is used again once the last outbreak is over.
  const lastOver = over.at(-1)!.t;
  expect(r.lounge.some((m) => m.t > lastOver && m.ids.length > 0)).toBe(true);
  // Staff with symptoms start no shift until they're clear; if at work when it starts, they go home.
  for (const s of onsets.filter((o) => !o.payload.personId.startsWith("res_"))) {
    const exposed = ofType(r.events, "infection.exposed").find((e) => e.payload.personId === s.payload.personId)!;
    const started = r.shiftsStarted.filter((x) => x.payload.staffId === s.payload.personId && x.t >= s.t && x.t < s.t + 3 * SECONDS_PER_DAY);
    expect(started.length, `${s.payload.personId} back too soon`).toBe(0);
    expect(exposed).toBeDefined();
  }
}

describe("routes", () => {
  it("combine as independent risks, so a route counted twice isn't double-counted", () => {
    expect(combine([])).toBe(0);
    expect(combine([0.1])).toBeCloseTo(0.1, 12);
    expect(combine([0.1, 0.2])).toBeCloseTo(1 - 0.9 * 0.8, 12);
    expect(combine([0.1, 0.2])).toBeLessThan(0.1 + 0.2);
    expect(combine([0.5, 0.5, 0.5])).toBeCloseTo(0.875, 12);
  });

  it("give contact only up close and the airborne proxy anywhere in the same room, weighted by disease", () => {
    const sim = createSim({ seed: "1", data, config });
    for (let i = 0; i < 4 * HOUR; i++) sim.step(); // 10:00, everyone up
    const w = sim.world;
    const [a, b] = [w.people.get("res_peggy")!, w.people.get("res_stan")!];
    const place = (p: typeof a, x: number, y: number) => Object.assign(p, { roomId: "Lounge", x, y });
    place(a, 10, 10);
    place(b, 11, 10);
    for (const disease of ["norovirus", "flu"] as const) {
      a.infection = { disease, exposedT: 0, route: "introduced", infectiousFromT: 0, symptomaticFromT: 0, symptomsEndT: 1e9, infectiousUntilT: 1e9, isolatedUntilT: 0, symptomatic: true, recovered: false, isolated: false };
      const near = routeChances(w, a, b);
      const weights = config.infection.diseases[disease].routes;
      expect(near.contact).toBeCloseTo(config.infection.contact.p_per_minute * weights.contact, 12);
      expect(near.airborne).toBeCloseTo((config.infection.airborne_proxy.p_per_hour_same_room / 60) * weights.airborne, 12);
      place(b, 15, 10);
      expect(routeChances(w, a, b).contact).toBe(0);
      expect(routeChances(w, a, b).airborne).toBe(near.airborne);
      Object.assign(b, { roomId: "Corridor" });
      expect(routeChances(w, a, b)).toEqual({ contact: 0, airborne: 0 });
      place(b, 11, 10);
    }
    expect(config.infection.diseases.norovirus.routes.contact).toBeGreaterThan(config.infection.diseases.norovirus.routes.airborne);
    expect(config.infection.diseases.flu.routes.airborne).toBeGreaterThan(config.infection.diseases.flu.routes.contact);
  });
});

describe("the norovirus-outbreak scenario", () => {
  const r = scenarioRun("norovirus-outbreak", 16);

  it("replays to a byte-identical log", () => {
    expect(scenarioRun("norovirus-outbreak", 16).hash).toBe(r.hash);
  });

  it("isolates Stan and Peggy, declares the outbreak at Peggy's case, closes the Lounge, restricts visits, and ends it 48 hours after the last case is symptom-free", () => {
    const iso = ofType(r.events, "infection.isolated").map((e) => e.payload.personId);
    expect(iso.slice(0, 2)).toEqual(["res_stan", "res_peggy"]);
    const declared = ofType(r.events, "outbreak.declared")[0]!;
    expect(declared.payload.disease).toBe("norovirus");
    expect(declared.payload.cases.slice(0, 2)).toEqual(["res_stan", "res_peggy"]);
    expect(formatSimTime(declared.t)).toMatch(/^Thu .* 09:10$/);
    outbreakOutcomes(r);
  });

  it("adds the PPE minutes to every visit to an isolated resident", () => {
    const iso = ofType(r.events, "infection.isolated").find((e) => e.payload.personId === "res_stan")!;
    const ended = ofType(r.events, "infection.isolation_ended").find((e) => e.payload.personId === "res_stan")!;
    const created = ofType(r.events, "task.created").filter((e) => e.payload.kind === "care.check" && e.payload.residentId === "res_stan");
    const minutes = (from: number, to: number) =>
      created
        .filter((c) => c.t > from && c.t < to)
        .map((c) => {
          const s = ofType(r.events, "task.started").find((x) => x.payload.taskId === c.payload.taskId);
          const d = ofType(r.events, "task.completed").find((x) => x.payload.taskId === c.payload.taskId);
          // Only visits wholly inside (or outside) isolation: the PPE time is judged as it goes.
          return s && d && d.t < to ? Math.round((d.t - s.t) / 60) : null;
        })
        .filter((m): m is number => m !== null);
    const during = minutes(iso.t, ended.t);
    const after = minutes(ended.t, ended.t + 3 * SECONDS_PER_DAY);
    expect(during.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    for (const m of during) expect(m).toBe(1 + config.infection.ppe_extra_mins);
    for (const m of after) expect(m).toBe(1);
  });
});

describe("the flu-outbreak scenario", () => {
  const r = scenarioRun("flu-outbreak", 16);

  it("replays to a byte-identical log", () => {
    expect(scenarioRun("flu-outbreak", 16).hash).toBe(r.hash);
  });

  it("isolates Win, keeps Tom off work, declares the outbreak at Tom's case and ends it 5 days after the last onset, once everyone is symptom-free", () => {
    expect(ofType(r.events, "infection.isolated")[0]!.payload.personId).toBe("res_win");
    const declared = ofType(r.events, "outbreak.declared")[0]!;
    expect(declared.payload).toMatchObject({ disease: "flu", cases: ["res_win", "stf_tom"] });
    // Tom was ill at home before his Friday early: he's off sick for it, with cover.
    const absent = ofType(r.events, "staff.absent").filter((e) => e.payload.staffId === "stf_tom");
    expect(absent.length).toBeGreaterThan(0);
    expect(absent[0]!.payload.reason).toBe("sick");
    outbreakOutcomes(r);
  });
});

describe("staff going home ill", () => {
  it("a carer taken ill at work goes home once the floor is covered, and the rest of the shift is covered", () => {
    const sim = createSim({ seed: "1", data, config });
    sim.enqueue({ seq: 1, applyTick: 4 * HOUR, type: "infection_case", payload: { personId: "stf_blessing", disease: "norovirus" }, source: "user" });
    const events: AnySimEvent[] = [];
    const hard: string[] = [];
    for (let i = 0; i < 12 * HOUR; i++) {
      events.push(...sim.step());
      for (const v of checkInvariants(sim.world)) hard.push(v.rule);
    }
    const home = ofType(events, "staff.absent").find((e) => e.payload.staffId === "stf_blessing")!;
    expect(home.payload.reason).toBe("went_home_sick");
    expect(ofType(events, "rota.cover_booked").some((e) => e.payload.forStaffId === "stf_blessing" && e.payload.slot === "early.lead")).toBe(true);
    expect(events.some((e) => e.type === "person.departed" && e.actors[0] === "stf_blessing" && e.t >= home.t)).toBe(true);
    expect(hard).toEqual([]);
  });

  it("without the tuning file an infection case is skipped, not applied", () => {
    const sim = createSim({ seed: "1", data });
    sim.enqueue({ seq: 1, applyTick: 5, type: "infection_case", payload: { personId: "res_win", disease: "flu" }, source: "user" });
    const events: AnySimEvent[] = [];
    for (let i = 0; i < 10; i++) events.push(...sim.step());
    expect(ofType(events, "input.skipped").map((e) => e.payload.inputType)).toEqual(["infection_case"]);
    expect(sim.world.people.get("res_win")!.infection).toBeNull();
  });
});

describe("introductions from the director", () => {
  it("are major events, and none comes during an outbreak's quiet period", () => {
    const loud = { ...config, infection: { ...config.infection, diseases: { norovirus: { ...config.infection.diseases.norovirus, per_winter: 60 }, flu: { ...config.infection.diseases.flu, per_winter: 60 } } } };
    const rng = createRng("intro/director");
    const memory: PlanMemory = { dayTypes: new Map(), majorTs: [], quietUntil: 20 * SECONDS_PER_DAY };
    const intros: number[] = [];
    let quiet = 0;
    for (let day = 1; day <= 60; day++) {
      const plan = planRandomDay(loud, rng, memory, day, day * SECONDS_PER_DAY - 1, [], data.residents.map(residentRisk));
      memory.dayTypes.set(day, plan.dayType);
      intros.push(...plan.planned.filter((e) => e.type === "infection_case").map((e) => e.applyT));
      quiet += plan.suppressed.filter((s) => s.reason.startsWith("outbreak quiet")).length;
    }
    expect(quiet).toBeGreaterThan(0);
    for (const t of intros) expect(t).toBeGreaterThanOrEqual(20 * SECONDS_PER_DAY);
    for (let i = 1; i < intros.length; i++) expect(intros[i]! - intros[i - 1]!).toBeGreaterThanOrEqual(48 * 3600);
  });
});

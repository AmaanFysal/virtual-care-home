// Visitors' missed weeks and celebrations (docs/10, sub-milestone d): the calendar (birthdays,
// Easter, festivals by faith), missed weeks planned with causes and seasons and keeping visits the
// same on average, a week off applied, the birthday-party scenario with its outcomes and a
// byte-identical replay, a celebration in a resident's room, no gathering in an outbreak, and the
// calendar's celebrations planned by the random director.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY, TICK_SECONDS, formatSimTime, type AnySimEvent, type DirectorSettings, type EventPayloads, type Scenario, type SimEvent } from "@vch/shared-types";
import { celebrationsOn, checkInvariants, createRng, createSim, easterSunday, planRandomDay, residentRisk, weekOffShare, type PlanMemory } from "../src/index.js";
import { loadAdmissions, loadDirectorConfig, loadScenario, loadWorldData } from "../tools/load-data.js";

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
  /** Minute by minute: who was in the Lounge. */
  lounge: { t: number; ids: string[] }[];
}

function run(director: DirectorSettings | undefined, days: number, seed = "1", inputs: { atHours: number; type: "visitor_week_off" | "celebration"; payload: object }[] = [], startT?: number): Run {
  const sim = createSim({ seed, data, admissions: loadAdmissions(), config, ...(director ? { director } : {}), ...(startT ? { startT } : {}) });
  inputs.forEach((x, i) => sim.enqueue({ seq: i + 1, applyTick: Math.round(x.atHours * HOUR), type: x.type, payload: x.payload as never, source: "user" }));
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
    if (sim.t % 60 === 0) lounge.push({ t: sim.t, ids: [...sim.world.people.values()].filter((p) => p.onMap && p.roomId === "Lounge").map((p) => p.id) });
  }
  return { events, hard, hash: hash.digest("hex"), lounge };
}

const scripted = (scenario: Scenario): DirectorSettings => ({ config, random: false, scenario });
const onDay = (t: number, day: number) => Math.floor(t / SECONDS_PER_DAY) === day;
const peggysFamily = data.visitors.filter((v) => v.relation_to_resident[0]!.resident === "res_peggy").map((v) => v.id);
/** Day index of a date in the sim's calendar (day 0 is Mon 2 Nov 2026). */
const dayOf = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 10, 2)) / 86400000);

describe("the calendar", () => {
  const cards = data.residents.map((r) => ({ id: r.id, name: r.name.known_as ?? r.name.first, dob: r.dob, faith: r.faith ?? "" }));

  it("finds Easter Sunday by the Gregorian computus", () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(easterSunday(2028)).toEqual({ month: 4, day: 16 });
    expect(easterSunday(2029)).toEqual({ month: 4, day: 1 });
  });

  it("has each resident's birthday from their card, and each festival for the residents whose faith keeps it", () => {
    expect(celebrationsOn(config.celebrations, dayOf(2027, 1, 19), cards)).toEqual([{ kind: "birthday", name: "Arthur's birthday", residentIds: ["res_arthur"] }]);
    // Christmas is kept by the whole wing, faith or none.
    expect(celebrationsOn(config.celebrations, dayOf(2026, 12, 25), cards)).toEqual([{ kind: "festival", name: "Christmas", residentIds: cards.map((c) => c.id) }]);
    // Easter for the Christian residents: not Raj (Sikh) or Stan (none).
    const easter = celebrationsOn(config.celebrations, dayOf(2027, 3, 28), cards);
    expect(easter).toEqual([{ kind: "festival", name: "Easter", residentIds: ["res_peggy", "res_win", "res_arthur", "res_dennis"] }]);
    expect(celebrationsOn(config.celebrations, dayOf(2027, 4, 14), cards)).toEqual([{ kind: "festival", name: "Vaisakhi", residentIds: ["res_raj"] }]);
    // Diwali for Kamala, once she has moved in.
    const kamala = loadAdmissions()[0]!.resident;
    const withKamala = [...cards, { id: kamala.id, name: kamala.name.first, dob: kamala.dob, faith: kamala.faith ?? "" }];
    expect(celebrationsOn(config.celebrations, dayOf(2026, 11, 8), cards)).toEqual([]);
    expect(celebrationsOn(config.celebrations, dayOf(2026, 11, 8), withKamala)).toEqual([{ kind: "festival", name: "Diwali", residentIds: ["res_kamala"] }]);
    expect(celebrationsOn(config.celebrations, dayOf(2027, 8, 15), withKamala).map((c) => c.name)).toEqual(["Kamala's birthday"]);
    // Every resident has exactly one birthday a year.
    let birthdays = 0;
    for (let day = dayOf(2027, 1, 1); day < dayOf(2028, 1, 1); day++) birthdays += celebrationsOn(config.celebrations, day, cards).filter((c) => c.kind === "birthday").length;
    expect(birthdays).toBe(cards.length);
  });
});

describe("visitors' missed weeks (planner)", () => {
  const leads = data.visitors.filter((v) => !v.accompanies).map((v) => ({ id: v.id, reliability: v.visit_pattern.reliability }));
  const regular = leads.filter((v) => v.reliability >= config.visitors.regular_from_reliability);
  const years = 100;
  const rng = createRng("weeks/director");
  const visitorRng = createRng("weeks/visitor_weeks");
  const memory: PlanMemory = { dayTypes: new Map(), majorTs: [] };
  const off: { id: string; cause: string; month: number }[] = [];
  for (let day = 1; day <= years * 365; day++) {
    const plan = planRandomDay(config, rng, memory, day, day * SECONDS_PER_DAY - 1, [], data.residents.map(residentRisk), { visitors: leads, visitorRng });
    memory.dayTypes.set(day, plan.dayType);
    memory.majorTs = memory.majorTs.filter((t) => t > (day - 7) * SECONDS_PER_DAY);
    for (const e of plan.planned) {
      if (e.type !== "visitor_week_off") continue;
      const p = e.params as { visitorId: string; cause: string };
      off.push({ id: p.visitorId, cause: p.cause, month: new Date(Date.UTC(2026, 10, 2) + day * 86400000).getUTCMonth() + 1 });
    }
  }

  it("come on Mondays for regular visitors only, at the planned rate (within 10%), never more than they could miss", () => {
    const expected = regular.reduce((s, v) => s + weekOffShare(config, v.reliability) * 52, 0) * years;
    expect(Math.abs(off.length - expected) / expected).toBeLessThan(0.1);
    const ids = new Set(off.map((o) => o.id));
    for (const v of leads) if (v.reliability < config.visitors.regular_from_reliability) expect(ids.has(v.id), v.id).toBe(false);
    // Kuldip (0.95) misses at most 5% of weeks.
    const kuldip = off.filter((o) => o.id === "vis_kuldip").length / (years * 52);
    expect(kuldip).toBeLessThanOrEqual(0.05 * 1.15);
  });

  it("have causes in their shares, holidays mostly in summer and illness mostly in winter", () => {
    const share = (c: string) => off.filter((o) => o.cause === c).length / off.length;
    expect(share("holiday")).toBeCloseTo(0.55, 1);
    expect(share("illness")).toBeCloseTo(0.25, 1);
    expect(share("family")).toBeCloseTo(0.2, 1);
    const inMonths = (c: string, months: number[]) => off.filter((o) => o.cause === c && months.includes(o.month)).length / off.filter((o) => o.cause === c).length;
    // July x2 and August x2.5 against 1 in most months: about 30% of holidays, against 17% for a flat year.
    expect(inMonths("holiday", [7, 8])).toBeGreaterThan(0.25);
    // November to March x1.8: about 56% of illness, against 42% for a flat year.
    expect(inMonths("illness", [11, 12, 1, 2, 3])).toBeGreaterThan(0.5);
  });

  it("keep visits the same on average: the other weeks are scaled up", () => {
    for (const v of regular) {
      const p = weekOffShare(config, v.reliability);
      const scaled = Math.min(1, v.reliability / (1 - p));
      expect((1 - p) * scaled, v.id).toBeCloseTo(v.reliability, 6);
    }
  });
});

describe("a week off", () => {
  // Linda (Peggy's daughter) is away from Tuesday; Mick only comes with her.
  const r = run(scripted({ id: "t", name: "t", description: "", random: false, events: [] }), 7, "1", [
    { atHours: 0.1, type: "visitor_week_off", payload: { visitorId: "vis_linda", cause: "holiday" } },
    { atHours: 0.2, type: "visitor_week_off", payload: { visitorId: "vis_mick", cause: "family" } },
  ]);

  it("is logged with its cause, and no visits come until the week is over", () => {
    const off = ofType(r.events, "visitor.week_off");
    expect(off.map((e) => [e.payload.visitorId, e.payload.cause])).toEqual([["vis_linda", "holiday"]]);
    const until = off[0]!.payload.untilT;
    expect(formatSimTime(until)).toMatch(/^Mon 09 Nov 00:00/);
    const lindaVisits = ofType(r.events, "visit.started").filter((e) => ["vis_linda", "vis_mick"].includes(e.payload.visitorId));
    expect(lindaVisits.filter((e) => e.t < until)).toEqual([]);
    expect(ofType(r.events, "input.skipped").map((e) => e.payload.reason)).toEqual(["only comes with their lead visitor"]);
    expect(r.hard).toEqual([]);
  });
});

describe("the birthday-party scenario", () => {
  const settings = scripted(loadScenario("birthday-party"));
  const runs = ["1", "2", "3", "4"].map((seed) => run(settings, 2.5, seed));
  const wed = 2;

  it("replays to a byte-identical log", () => {
    expect(run(settings, 2.5, "1").hash).toBe(runs[0]!.hash);
  });

  it("brings Peggy's family in the afternoon, for longer, and they're at tea and cake in the Lounge with Bev", () => {
    for (const r of runs) {
      const started = ofType(r.events, "celebration.started")[0]!;
      expect(started.payload).toMatchObject({ kind: "birthday", residentIds: ["res_peggy"], gathering: true });
      expect(started.source).toBe("director");
      const tea = ofType(r.events, "celebration.tea")[0]!;
      expect(formatSimTime(tea.t)).toMatch(/^Wed 04 Nov 16:00/);
      expect(tea.payload.roomId).toBe("Lounge");
      expect(tea.payload.staffId).toBe("stf_bev");
      expect(tea.payload.residentIds).toContain("res_peggy");
      const family = tea.payload.visitorIds.filter((id) => peggysFamily.includes(id));
      expect(family.length).toBeGreaterThanOrEqual(2);
      // Everyone planned for the party arrives 14:00 to 15:00 and stays at least 2 hours.
      const planned = ofType(r.events, "visit.planned").filter((e) => e.t === started.t);
      expect(planned.length).toBeGreaterThan(0);
      for (const p of planned) {
        const tod = p.payload.arriveT % SECONDS_PER_DAY;
        expect(tod).toBeGreaterThanOrEqual(14 * 3600);
        expect(tod).toBeLessThanOrEqual(15 * 3600);
        expect(p.payload.durationMins).toBeGreaterThanOrEqual(120);
      }
      expect(r.hard).toEqual([]);
    }
  });

  it("has more of her family and more people in the Lounge than an ordinary Wednesday", () => {
    let partyFamily = 0;
    let ordinaryFamily = 0;
    let partyLounge = 0;
    let ordinaryLounge = 0;
    for (const [i, r] of runs.entries()) {
      const plain = run(undefined, 2.5, String(i + 1));
      const family = (x: Run) => new Set(ofType(x.events, "visit.started").filter((e) => onDay(e.t, wed) && peggysFamily.includes(e.payload.visitorId)).map((e) => e.payload.visitorId)).size;
      const teaTime = (x: Run) => x.lounge.filter((m) => onDay(m.t, wed) && m.t % SECONDS_PER_DAY >= 15 * 3600 && m.t % SECONDS_PER_DAY < 16 * 3600).reduce((s, m) => s + m.ids.length, 0);
      partyFamily += family(r);
      ordinaryFamily += family(plain);
      partyLounge += teaTime(r);
      ordinaryLounge += teaTime(plain);
    }
    expect(partyFamily).toBeGreaterThan(ordinaryFamily);
    expect(partyLounge).toBeGreaterThan(ordinaryLounge * 1.3);
  });
});

describe("celebrations elsewhere", () => {
  it("has tea and cake in Raj's room for his birthday (he doesn't use the Lounge), with Bev and his family", () => {
    const r = run(scripted({ id: "t", name: "t", description: "", random: false, events: [{ day: "Wed", time: "00:05", type: "celebration", params: { kind: "birthday", name: "Raj's birthday", residentIds: ["res_raj"] } }] }), 2.5);
    const tea = ofType(r.events, "celebration.tea")[0]!;
    expect(tea.payload).toMatchObject({ roomId: "Room3", staffId: "stf_bev", residentIds: ["res_raj"] });
    expect(tea.payload.visitorIds.some((id) => ["vis_kuldip", "vis_harpreet"].includes(id))).toBe(true);
    expect(r.hard).toEqual([]);
  });

  it("has no gathering during an outbreak: no extra visits, no tea, the Lounge stays closed", () => {
    const r = run(
      scripted({
        id: "t",
        name: "t",
        description: "",
        random: false,
        events: [
          { day: "Tue", time: "10:00", type: "infection_case", params: { personId: "res_stan", disease: "norovirus" } },
          { day: "Tue", time: "10:05", type: "infection_case", params: { personId: "res_win", disease: "norovirus" } },
          { day: "Wed", time: "00:05", type: "celebration", params: { kind: "birthday", name: "Peggy's birthday", residentIds: ["res_peggy"] } },
        ],
      }),
      2.5,
    );
    const started = ofType(r.events, "celebration.started")[0]!;
    expect(started.payload).toMatchObject({ gathering: false, reason: "outbreak: no gathering, essential visits only" });
    expect(ofType(r.events, "visit.planned").filter((e) => e.t === started.t)).toEqual([]);
    expect(ofType(r.events, "celebration.tea")).toEqual([]);
    expect(r.lounge.filter((m) => onDay(m.t, 2) && m.ids.some((id) => id.startsWith("res_")))).toEqual([]);
    expect(r.hard).toEqual([]);
  });

  it("is planned from the calendar by the random director: Christmas for the whole wing", () => {
    const christmas = dayOf(2026, 12, 25);
    const r = run({ config, random: true }, 1, "1", [], christmas * SECONDS_PER_DAY + 6 * 3600);
    const planned = ofType(r.events, "director.planned").find((e) => e.payload.inputType === "celebration")!;
    expect(planned.payload).toMatchObject({ origin: "calendar", reason: "festival (the residents' faith)" });
    const started = ofType(r.events, "celebration.started")[0]!;
    expect(started.payload).toMatchObject({ kind: "festival", name: "Christmas", gathering: true });
    expect(started.payload.residentIds).toHaveLength(6);
    // Christmas 2026 is a Friday, when Bev isn't on: cake comes with the carers' afternoon tea.
    expect(ofType(r.events, "celebration.tea")[0]!.payload).toMatchObject({ roomId: "Lounge", staffId: null });
    expect(r.hard).toEqual([]);
  });
});

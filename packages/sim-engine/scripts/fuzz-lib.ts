// The fuzz runner's library (the simulation audit, docs/workstreams/sim-audit/): random cases of
// director events in themes, a run of one case with every safety rule checked every tick
// (src/safety.ts), signatures for comparing with a calm baseline, and shrinking a failing case to
// the fewest events that still fail. The CLI and its worker pool are in fuzz.ts; tests use this.

import { readFileSync } from "node:fs";
import {
  DEFAULT_START_T,
  DISEASES,
  ILLNESS_KINDS,
  ROTA_SLOTS,
  SECONDS_PER_DAY,
  WEEK_OFF_CAUSES,
  clockToSeconds,
  dayIndex,
  type AnySimEvent,
  type Scenario,
  type WorldData,
} from "@vch/shared-types";
import { createRng, createSim } from "../src/index.js";
import type { Rng } from "../src/rng.js";
import { createSafetyMonitor, type SafetyViolation } from "../src/safety.js";
import { loadAdmissions, loadDirectorConfig } from "../tools/load-data.js";

type ScenarioEvent = Scenario["events"][number];

export interface FuzzCase {
  id: string;
  index: number;
  theme: string;
  seed: number;
  days: number;
  random: boolean;
  events: ScenarioEvent[];
}

export interface CaseResult {
  id: string;
  theme: string;
  seed: number;
  days: number;
  random: boolean;
  events: number;
  /** First time each violation key started failing (at most 3 for each rule and person), and how many keys per rule. */
  violations: SafetyViolation[];
  counts: Record<string, number>;
  breaches: number;
  skipped: { type: string; reason: string }[];
  crash: string | null;
  ms: number;
}

// ------------------------------------------------------------------ case generation

const AWKWARD = [
  "06:40", "06:55", "07:00", "07:05", "07:15", "07:45", "07:58", "08:00", "08:05", "08:30", "10:30", "10:40", "10:45", "11:45", "11:50", "12:15",
  "12:40", "13:00", "13:30", "14:00", "14:10", "14:30", "14:45", "15:00", "16:00", "17:00", "17:30", "19:30", "19:45", "20:00", "20:55", "21:00",
  "21:15", "21:30", "22:00", "23:30", "00:00", "01:30", "02:00", "03:00", "04:00", "05:30", "06:00",
];
const THEMES: [string, number][] = [
  ["cluster", 3],
  ["back_to_back", 3],
  ["outbreak", 3],
  ["short_staffed", 2],
  ["eol_chain", 2],
  ["holiday", 2],
  ["illness_mix", 2],
  ["random_plus", 2],
  ["hospital_return", 2],
  ["night", 2],
];

export interface Pools {
  residents: string[];
  careStaff: string[];
  anyStaff: string[];
  leadVisitors: string[];
  names: Map<string, string>;
}

export function pools(data: WorldData): Pools {
  return {
    residents: data.residents.map((r) => r.id).sort(),
    careStaff: data.staff.filter((s) => ["registered_nurse", "senior_carer", "care_assistant"].includes(s.role)).map((s) => s.id).sort(),
    anyStaff: data.staff.map((s) => s.id).sort(),
    leadVisitors: data.visitors.filter((v) => !v.accompanies).map((v) => v.id).sort(),
    names: new Map(data.residents.map((r) => [r.id, r.name.known_as])),
  };
}

const START_DAY = dayIndex(DEFAULT_START_T);

/** Absolute sim time: `day` days after the start day at `clock`, plus a few minutes' jitter; always after the start. */
function at(day: number, clock: string, jitterMins = 0): number {
  let t = (START_DAY + day) * SECONDS_PER_DAY + clockToSeconds(clock) + jitterMins * 60;
  if (t <= DEFAULT_START_T) t += SECONDS_PER_DAY;
  return t;
}

function awkward(rng: Rng, day: number): number {
  return at(day, rng.pick(AWKWARD), rng.chance(0.5) ? 0 : rng.int(-3, 3));
}

function makeEvent(rng: Rng, pl: Pools, t: number, kind?: string): ScenarioEvent {
  const k = kind ?? rng.pick(["fall", "fall", "fall", "sick", "noshow", "infection", "illness", "illness", "eol", "weekoff", "celebration"]);
  const resident = rng.pick(pl.residents);
  const cover = rng.pick(["auto", "auto", "bank", "agency", "none"] as const);
  switch (k) {
    case "fall":
      return { t, type: "inject_fall", params: { residentId: resident, severity: rng.chance(0.3) ? "serious" : "minor" } };
    case "sick":
      return { t, type: "staff_sick", params: { staffId: rng.pick(pl.careStaff), cover } };
    case "noshow":
      return { t, type: "shift_no_show", params: { slot: rng.pick([...ROTA_SLOTS]), cover } };
    case "infection":
      return { t, type: "infection_case", params: { personId: rng.chance(0.75) ? resident : rng.pick(pl.anyStaff), disease: rng.pick([...DISEASES]) } };
    case "illness":
      return { t, type: "resident_illness", params: { residentId: resident, kind: rng.pick([...ILLNESS_KINDS]), severity: rng.chance(0.5) ? "severe" : "mild" } };
    case "eol":
      return { t, type: "end_of_life_start", params: { residentId: resident, expectedDays: rng.int(1, 4) } };
    case "admission":
      return { t, type: "admission", params: { cardId: "adm_kamala" } };
    case "weekoff":
      return { t, type: "visitor_week_off", params: { visitorId: rng.pick(pl.leadVisitors), cause: rng.pick([...WEEK_OFF_CAUSES]) } };
    default:
      return rng.chance(0.5)
        ? { t, type: "celebration", params: { kind: "birthday", name: `${pl.names.get(resident)}'s birthday`, residentIds: [resident] } }
        : { t, type: "celebration", params: { kind: "festival", name: "Christmas", residentIds: [...pl.residents] } };
  }
}

export function generateCase(index: number, pl: Pools): FuzzCase {
  const rng = createRng(`fuzz-${index}`);
  const total = THEMES.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  let theme = THEMES[0]![0];
  for (const [name, w] of THEMES) {
    roll -= w;
    if (roll < 0) {
      theme = name;
      break;
    }
  }
  const seed = rng.int(1, 40);
  let days = 3;
  let random = false;
  const events: ScenarioEvent[] = [];
  const ev = (t: number, kind?: string) => events.push(makeEvent(rng, pl, t, kind));
  switch (theme) {
    case "cluster": {
      // Several at once, at an awkward minute.
      const t = awkward(rng, rng.int(0, 1));
      for (let i = rng.int(2, 5); i > 0; i--) ev(t);
      if (rng.chance(0.5)) ev(t + rng.int(1, 90) * 60);
      break;
    }
    case "back_to_back": {
      let t = awkward(rng, rng.int(0, 1));
      for (let i = rng.int(3, 6); i > 0; i--) {
        ev(t);
        t += rng.int(1, 20) * 60;
      }
      break;
    }
    case "outbreak": {
      // An infection (often two, to declare an outbreak), then other events during it.
      days = 5;
      const disease = rng.pick([...DISEASES]);
      const t0 = awkward(rng, 0);
      const r1 = rng.pick(pl.residents);
      events.push({ t: t0, type: "infection_case", params: { personId: r1, disease } });
      if (rng.chance(0.7)) {
        const r2 = rng.pick(pl.residents.filter((r) => r !== r1));
        events.push({ t: t0 + rng.int(30, 20 * 60) * 60, type: "infection_case", params: { personId: r2, disease } });
      }
      for (let i = rng.int(2, 5); i > 0; i--) ev(awkward(rng, rng.int(1, 3)), rng.pick(["fall", "fall", "eol", "celebration", "celebration", "admission", "illness", "sick", "noshow", "weekoff"]));
      break;
    }
    case "short_staffed": {
      const day = rng.int(0, 1);
      for (let i = rng.int(1, 3); i > 0; i--) ev(at(day, rng.pick(["05:30", "06:00", "06:20", "12:30", "13:10", "19:45", "20:30"])), rng.pick(["sick", "sick", "noshow"]));
      for (let i = rng.int(1, 4); i > 0; i--) ev(awkward(rng, day), rng.pick(["fall", "fall", "illness", "infection", "celebration"]));
      break;
    }
    case "eol_chain": {
      // A short decline and a death, then someone moving in, with other things around them.
      days = rng.chance(0.5) ? 5 : 7;
      const t0 = awkward(rng, 0);
      events.push({ t: t0, type: "end_of_life_start", params: { residentId: rng.pick(pl.residents), expectedDays: rng.int(1, 2) } });
      events.push({ t: at(rng.int(3, 4), rng.pick(["10:00", "13:30", "15:00", "21:00", "02:00"])), type: "admission", params: { cardId: "adm_kamala" } });
      for (let i = rng.int(1, 4); i > 0; i--) ev(awkward(rng, rng.int(0, days - 2)), rng.pick(["fall", "infection", "celebration", "illness", "sick", "weekoff"]));
      break;
    }
    case "holiday": {
      // A celebration and an infection, in either order, the same day or a day apart.
      const day = rng.int(0, 1);
      const party = makeEvent(rng, pl, at(day, "00:30"), "celebration");
      const infT = rng.chance(0.5) ? at(day, rng.pick(["07:00", "11:00", "14:30", "15:10", "15:30"])) : at(day === 0 ? 1 : day - 1, rng.pick(["09:00", "16:00", "22:00"]));
      const disease = rng.pick([...DISEASES]);
      const r1 = rng.pick(pl.residents);
      events.push(party, { t: infT, type: "infection_case", params: { personId: r1, disease } });
      if (rng.chance(0.5)) events.push({ t: infT + rng.int(10, 600) * 60, type: "infection_case", params: { personId: rng.pick(pl.residents.filter((r) => r !== r1)), disease } });
      if (rng.chance(0.5)) ev(awkward(rng, day));
      break;
    }
    case "illness_mix": {
      // Severe illness (GP, then an ambulance) with a fall or a decline close behind; long enough to come back.
      days = rng.chance(0.4) ? 10 : 3;
      const t0 = awkward(rng, rng.int(0, 1));
      const r = rng.pick(pl.residents);
      events.push({ t: t0, type: "resident_illness", params: { residentId: r, kind: rng.pick([...ILLNESS_KINDS]), severity: rng.chance(0.7) ? "severe" : "mild" } });
      for (let i = rng.int(1, 3); i > 0; i--) {
        const e = makeEvent(rng, pl, t0 + rng.int(10, 6 * 60) * 60, rng.pick(["fall", "eol", "infection", "illness"]));
        if ("residentId" in (e.params as object) && rng.chance(0.7)) (e.params as { residentId: string }).residentId = r;
        events.push(e);
      }
      break;
    }
    case "hospital_return": {
      // Someone goes to hospital early on, and things happen while they're away and when they're back.
      days = rng.pick([12, 16, 21]);
      const r = rng.pick(pl.residents);
      const t0 = awkward(rng, 0);
      events.push(
        rng.chance(0.5)
          ? { t: t0, type: "inject_fall", params: { residentId: r, severity: "serious" } }
          : { t: t0, type: "resident_illness", params: { residentId: r, kind: rng.pick(["uti", "dehydration", "chest_infection"] as const), severity: "severe" } },
      );
      for (let i = rng.int(2, 5); i > 0; i--) {
        const e = makeEvent(rng, pl, awkward(rng, rng.int(2, days - 2)), rng.pick(["infection", "infection", "eol", "celebration", "fall", "illness", "sick"]));
        if ("residentId" in (e.params as object) && rng.chance(0.5)) (e.params as { residentId: string }).residentId = r;
        if (e.type === "infection_case" && rng.chance(0.5)) (e.params as { personId: string }).personId = r;
        events.push(e);
      }
      break;
    }
    case "night": {
      // The lone night carer: a night with no cover or a carer taken ill, and falls or illness in the small hours.
      const day = rng.int(0, 1);
      if (rng.chance(0.6)) events.push({ t: at(day, rng.pick(["20:30", "20:45", "21:10"])), type: "shift_no_show", params: { slot: "night.carer", cover: rng.pick(["none", "none", "auto", "agency"] as const) } });
      if (rng.chance(0.4)) events.push({ t: at(day, "22:00"), type: "infection_case", params: { personId: rng.pick(["stf_florin", "stf_aisha"]), disease: rng.pick([...DISEASES]) } });
      for (let i = rng.int(1, 4); i > 0; i--) ev(at(day + 1, rng.pick(["00:30", "01:30", "02:00", "02:10", "03:00", "04:00", "05:30", "06:30", "06:50"]), rng.int(0, 20)), rng.pick(["fall", "fall", "fall", "illness", "eol"]));
      break;
    }
    default: {
      // The random director on top, with a few scripted events.
      random = true;
      days = 7;
      for (let i = rng.int(2, 4); i > 0; i--) ev(awkward(rng, rng.int(0, 5)));
    }
  }
  events.sort((a, b) => a.t! - b.t!);
  return { id: `fuzz-${String(index).padStart(5, "0")}`, index, theme, seed, days, random, events };
}

export function toScenario(c: Pick<FuzzCase, "id" | "theme" | "seed" | "days" | "random" | "events">, extra: Record<string, unknown> = {}): Scenario & Record<string, unknown> {
  return {
    id: c.id,
    name: `Audit case ${c.id} (${c.theme})`,
    description: `Generated by the simulation audit's fuzz runner. Run with seed ${c.seed} for ${c.days * 24} hours.`,
    random: c.random,
    events: c.events,
    ...extra,
  };
}

// ------------------------------------------------------------------ running

/** Examples kept for each rule and person (a signature), so a replay can be checked for one resident. */
const MAX_PER_SIGNATURE = 3;

export function runCase(c: Pick<FuzzCase, "id" | "theme" | "seed" | "days" | "random" | "events">, data: WorldData, stopAfterT?: number): CaseResult {
  const started = performance.now();
  const scenario = toScenario(c);
  const out: CaseResult = { id: c.id, theme: c.theme, seed: c.seed, days: c.days, random: c.random, events: c.events.length, violations: [], counts: {}, breaches: 0, skipped: [], crash: null, ms: 0 };
  try {
    const sim = createSim({ seed: String(c.seed), data, admissions: loadAdmissions(), director: { config: loadDirectorConfig(), random: c.random, scenario } });
    const monitor = createSafetyMonitor();
    let failing = new Set<string>();
    const end = Math.min(DEFAULT_START_T + c.days * SECONDS_PER_DAY, stopAfterT ?? Infinity);
    while (sim.t < end) {
      const events: AnySimEvent[] = sim.step();
      for (const e of events) {
        if (e.type === "sla.breached") out.breaches += 1;
        if (e.type === "input.skipped") out.skipped.push({ type: e.payload.inputType, reason: e.payload.reason });
      }
      const now = new Set<string>();
      for (const v of monitor.check(sim.world, events)) {
        now.add(v.key);
        if (failing.has(v.key)) continue;
        out.counts[v.rule] = (out.counts[v.rule] ?? 0) + 1;
        if (out.violations.filter((x) => signature(x) === signature(v)).length < MAX_PER_SIGNATURE) out.violations.push(v);
      }
      failing = now;
    }
  } catch (err) {
    out.crash = err instanceof Error ? `${err.message}\n${err.stack?.split("\n").slice(1, 6).join("\n")}` : String(err);
  }
  out.ms = Math.round(performance.now() - started);
  return out;
}

/** What a violation is about, for comparing with the calm baseline: the rule and its first person. */
export function signature(v: Pick<SafetyViolation, "rule" | "key">): string {
  const subject = v.key.split(":").slice(1).find((part) => /^(res|stf|vis|agy|ext)_/.test(part)) ?? "";
  return `${v.rule}:${subject}`;
}

export function signatures(r: CaseResult): Set<string> {
  const s = new Set(r.violations.map(signature));
  if (r.crash) s.add("engine_crash:");
  return s;
}

/**
 * Shrinks a failing case: drops events one at a time while the same signature still fails, and
 * stops the run 2 hours after the first violation.
 */
export function minimise(c: FuzzCase, sig: string, data: WorldData): { c: FuzzCase; v: SafetyViolation | null; crash: string | null } {
  const fails = (x: FuzzCase) => {
    const r = runCase(x, data);
    if (sig === "engine_crash:") return r.crash ? { v: null, crash: r.crash } : null;
    const v = r.violations.find((y) => signature(y) === sig);
    return v ? { v, crash: null } : null;
  };
  let best = { ...c, events: [...c.events] };
  let hit = fails(best);
  if (!hit) return { c, v: null, crash: null };
  if (best.random) {
    const off = { ...best, random: false };
    const h = fails(off);
    if (h) (best = off), (hit = h);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < best.events.length; i++) {
      const fewer = { ...best, events: best.events.filter((_, j) => j !== i) };
      const h = fails(fewer);
      if (h) {
        best = fewer;
        hit = h;
        changed = true;
        break;
      }
    }
  }
  // Only as long as it takes to see it, plus a little (whole hours, for the CLI).
  const failT = hit.v?.t ?? DEFAULT_START_T + best.days * SECONDS_PER_DAY;
  const hours = Math.min(best.days * 24, Math.ceil((failT - DEFAULT_START_T) / 3600) + 1);
  return { c: { ...best, days: hours / 24 }, v: hit.v, crash: hit.crash };
}


/**
 * A saved scenario file with its `audit` block: the seed and hours to run it for, the gaps it shows
 * (docs/workstreams/sim-audit/report.md), the rules it breaks ("rule" or "rule@person"), whether it
 * still does ("fails") or no longer should ("passes", once fixed), and the PR that fixes it.
 */
export type AuditScenario = Scenario & { audit?: { seed: number; hours: number; gaps?: string[]; rules?: string[]; expect?: "fails" | "passes"; fixIn?: string } };

/** Whether a run broke a rule written as "rule" or "rule@person". */
export function broke(r: CaseResult, rule: string): boolean {
  const [name, person] = rule.split("@");
  return r.violations.some((v) => v.rule === name && (!person || v.key.split(":").includes(person)));
}

export function loadAuditScenario(path: string): AuditScenario {
  return JSON.parse(readFileSync(path, "utf8")) as AuditScenario;
}

/** Runs a saved scenario file for its seed and hours with every safety rule on. */
export function runScenarioFile(s: AuditScenario, data: WorldData): CaseResult {
  const seed = s.audit?.seed ?? 1;
  const hours = s.audit?.hours ?? 72;
  return runCase({ id: s.id, theme: "replay", seed, days: hours / 24, random: s.random, events: s.events }, data);
}

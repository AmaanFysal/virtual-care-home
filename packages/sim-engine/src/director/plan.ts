// The director's daily plan from base rates (docs/10). Pure: given the tuning, a random stream,
// the day's roster and the residents, it draws the day type, sick calls and no-shows, and falls,
// then applies the pacing caps. The engine calls it at 00:00 (and at the start); the rates
// script calls it on its own to measure realised rates over many years.

import { DISEASES, ILLNESS_KINDS, SECONDS_PER_DAY, WEEK_OFF_CAUSES, clockToSeconds, simDate, type DayType, type DirectorConfig, type Resident, type ShiftName, type WeekOffCause } from "@vch/shared-types";
import type { Rng } from "../rng.js";
import type { DirectorEvent } from "../state.js";

/** A shift on the day's roster that hasn't started. */
export interface RosterEntry {
  personId: string;
  slot: string;
  shift: ShiftName;
  startT: number;
  endT: number;
  agency: boolean;
  /** The staff card's `sickness_propensity` (chance per rostered shift). */
  propensity: number;
}

export interface ResidentRisk {
  id: string;
  risk: "high" | "medium" | "low";
  bedBound: boolean;
  /** Seconds since midnight their sundowning starts, if they sundown. */
  sundownOnset: number | null;
  /** On an end-of-life care plan already (likelier to be the one whose decline begins). */
  endOfLifePlan: boolean;
  /** A multiplier on their falls today (ill, or just back from hospital). */
  extra?: number;
  /** Already ill or at the end of life: no new illness or decline for them today. */
  busy?: boolean;
}

/** A lead visitor, for their missed weeks (sub-milestone d). */
export interface VisitorRisk {
  id: string;
  reliability: number;
  /** Their resident is at the end of their life: the family doesn't go away. */
  staying?: boolean;
}

/** What the planner remembers between days (pacing). */
export interface PlanMemory {
  dayTypes: Map<number, DayType | "scripted">;
  majorTs: number[];
  /** No infection is introduced before this (an outbreak on, or ended under 14 days ago). */
  quietUntil?: number;
}

export interface DayPlan {
  dayType: DayType;
  /** The type drawn before the hard-day cap turned it into a busy day. */
  downgradedFrom: DayType | null;
  planned: DirectorEvent[];
  suppressed: { event: DirectorEvent; reason: string }[];
}

const DAY_TYPES: DayType[] = ["ordinary", "busy", "hard"];

export function residentRisk(r: Resident): ResidentRisk {
  const onset = r.cognition.sundowning?.onset;
  return { id: r.id, risk: r.mobility.falls_risk, bedBound: r.care.bed_bound, sundownOnset: onset ? clockToSeconds(onset) : null, endOfLifePlan: r.conditions.some((c) => /end of life/i.test(c)) };
}

/** Is this a major event (docs/10 pacing)? In sub-milestone (a) only a serious fall is. */
export function isMajor(e: Pick<DirectorEvent, "type" | "params">): boolean {
  return (
    (e.type === "inject_fall" && (e.params as { severity: string }).severity === "serious") ||
    e.type === "infection_case" ||
    (e.type === "resident_illness" && (e.params as { severity: string }).severity === "severe") ||
    e.type === "end_of_life_start" ||
    e.type === "admission"
  );
}

/** Whether a major event at `t` keeps to the caps, given the majors already planned or applied. */
export function majorAllowed(config: DirectorConfig, majorTs: number[], t: number): string | null {
  const day = Math.floor(t / SECONDS_PER_DAY);
  const sameDay = majorTs.filter((m) => Math.floor(m / SECONDS_PER_DAY) === day).length;
  if (sameDay >= config.pacing.max_major_per_day) return "major-event cap: one a day";
  if (majorTs.some((m) => Math.abs(m - t) < config.pacing.min_hours_between_major * 3600)) return `major-event cap: ${config.pacing.min_hours_between_major} h apart`;
  return null;
}

export function planRandomDay(
  config: DirectorConfig,
  rng: Rng,
  memory: PlanMemory,
  day: number,
  fromT: number,
  roster: RosterEntry[],
  residents: ResidentRisk[],
  opts: { deaths?: boolean; endOfLifeOn?: boolean; visitors?: VisitorRisk[]; visitorRng?: Rng } = {},
): DayPlan {
  const planned: DirectorEvent[] = [];
  const suppressed: DayPlan["suppressed"] = [];
  const dayStart = day * SECONDS_PER_DAY;

  // 1. The day type.
  const u = rng.next();
  let acc = 0;
  let dayType: DayType = "hard";
  for (const type of DAY_TYPES) {
    acc += config.day_types[type].p;
    if (u < acc) {
      dayType = type;
      break;
    }
  }
  let downgradedFrom: DayType | null = null;
  if (dayType === "hard") {
    let hardThisWeek = 0;
    for (let d = day - 6; d < day; d++) if (memory.dayTypes.get(d) === "hard") hardThisWeek += 1;
    if (hardThisWeek >= config.pacing.max_hard_days_per_week) (downgradedFrom = "hard"), (dayType = "busy");
  }
  const rate = config.day_types[dayType].rate;
  const origin = "random";

  // 2. Sick calls (named staff) and no-shows (agency), at most a few a day.
  const { absence } = config;
  const winter = absence.winter_months.includes(simDate(dayStart).month) ? absence.winter_factor : 1;
  const shortShifts: [number, number][] = [];
  let absences = 0;
  for (const a of [...roster].sort((x, y) => x.startT - y.startT || x.personId.localeCompare(y.personId))) {
    if (!absence.slots.includes(a.slot)) continue;
    const p = (a.agency ? absence.agency_no_show : a.propensity * winter) * rate;
    const hit = rng.chance(p);
    const [lo, hi] = absence.call_mins_before;
    const lead = rng.int(lo, hi);
    if (!hit) continue;
    const event: DirectorEvent = a.agency
      ? { applyT: a.startT - 15 * 60, type: "shift_no_show", params: { slot: a.slot }, origin }
      : { applyT: a.startT - lead * 60, type: "staff_sick", params: { staffId: a.personId }, origin };
    if (event.applyT <= fromT) continue;
    if (absences >= config.pacing.max_absences_per_day) {
      suppressed.push({ event, reason: `absence cap: ${config.pacing.max_absences_per_day} a day` });
      continue;
    }
    absences += 1;
    planned.push(event);
    shortShifts.push([a.startT, a.endT]);
  }

  // 3. Falls, hour by hour for each resident. Risk multipliers share out the wing's rate, and
  //    sundowning moves falls towards dusk; the day type and short staffing raise them.
  const { falls } = config;
  const factor = (r: ResidentRisk) => falls.risk[r.risk] * (r.bedBound ? falls.bed_bound : 1);
  const meanFactor = residents.length > 0 ? residents.reduce((s, r) => s + factor(r), 0) / residents.length : 1;
  for (const r of residents) {
    const profile = falls.hour_weights.map((w, h) => w * (sundowning(r, h, falls.sundowning.hours) ? falls.sundowning.factor : 1));
    const total = profile.reduce((s, w) => s + w, 0);
    const perDay = (falls.per_resident_year / 365) * (factor(r) / meanFactor) * rate * (r.extra ?? 1);
    for (let h = 0; h < 24; h++) {
      const hourT = dayStart + h * 3600;
      const short = shortShifts.some(([s, e]) => hourT + 1800 >= s && hourT + 1800 < e) ? falls.short_staffed : 1;
      if (!rng.chance((perDay * profile[h]!) / total * short)) continue;
      const applyT = hourT + rng.int(0, 59) * 60;
      const severity = rng.chance(falls.serious_share) ? "serious" : "minor";
      const event: DirectorEvent = { applyT, type: "inject_fall", params: { residentId: r.id, severity }, origin };
      if (applyT <= fromT) continue;
      if (severity === "serious") {
        const capped = majorAllowed(config, memory.majorTs, applyT);
        if (capped) {
          suppressed.push({ event, reason: capped });
          continue;
        }
        memory.majorTs.push(applyT);
      }
      planned.push(event);
    }
  }

  // 4. Infections brought in from outside (a visitor, a new admission, staff), mostly in winter:
  //    a major event, and none while an outbreak is on or within 14 days of one ending.
  const isWinter = absence.winter_months.includes(simDate(dayStart).month);
  const winterDays = 151;
  for (const disease of DISEASES) {
    const d = config.infection.diseases[disease];
    const perDay = (isWinter ? d.per_winter / winterDays : d.per_summer / (365 - winterDays)) * rate;
    if (!rng.chance(perDay)) continue;
    const applyT = dayStart + rng.int(7 * 60, 21 * 60) * 60;
    const staff = [...new Set(roster.filter((a) => !a.agency).map((a) => a.personId))].sort();
    const fromStaff = rng.chance(config.infection.index_staff_share) && staff.length > 0;
    const pool = fromStaff ? staff : residents.map((r) => r.id);
    if (pool.length === 0) continue;
    const event: DirectorEvent = { applyT, type: "infection_case", params: { personId: rng.pick(pool), disease }, origin };
    if (applyT <= fromT) continue;
    if (applyT < (memory.quietUntil ?? 0)) {
      suppressed.push({ event, reason: "outbreak quiet period (14 days)" });
      continue;
    }
    const capped = majorAllowed(config, memory.majorTs, applyT);
    if (capped) {
      suppressed.push({ event, reason: capped });
      continue;
    }
    memory.majorTs.push(applyT);
    planned.push(event);
  }

  // 5. Illness (docs/10): the illness-driven share of emergency admissions (all admissions less
  //    serious falls), over the severe share, split by kind; chest infections in winter.
  const h = config.health;
  const illnessPerYear = (h.admissions_per_resident_year - falls.per_resident_year * falls.serious_share) / h.illness.severe_share;
  for (const r of residents) {
    for (const kind of ILLNESS_KINDS) {
      const k = h.illness.kinds[kind];
      const season = isWinter ? k.winter_factor : (12 - 5 * k.winter_factor) / 7;
      if (!rng.chance((illnessPerYear / 365) * k.share * season * rate)) continue;
      const severity = rng.chance(h.illness.severe_share) ? "severe" : "mild";
      const applyT = dayStart + rng.int(7 * 60, 21 * 60) * 60;
      const event: DirectorEvent = { applyT, type: "resident_illness", params: { residentId: r.id, kind, severity }, origin };
      if (applyT <= fromT || r.busy) continue;
      if (severity === "severe") {
        const capped = majorAllowed(config, memory.majorTs, applyT);
        if (capped) {
          suppressed.push({ event, reason: capped });
          continue;
        }
        memory.majorTs.push(applyT);
      }
      planned.push(event);
      r.busy = true;
    }
  }

  // 6. End of life: deaths at the base rate, through a planned decline; someone already on an
  //    end-of-life care plan is much likelier. One at a time; none when deaths are off.
  if (opts.deaths !== false && residents.length > 0) {
    const weight = (r: ResidentRisk) => (r.endOfLifePlan ? h.end_of_life.end_of_life_weight : 1);
    const mean = residents.reduce((s, r) => s + weight(r), 0) / residents.length;
    for (const r of residents) {
      if (!rng.chance((h.end_of_life.deaths_per_resident_year / 365) * (weight(r) / mean) * rate)) continue;
      const expectedDays = rng.int(h.end_of_life.expected_days[0], h.end_of_life.expected_days[1]);
      const applyT = dayStart + rng.int(9 * 60, 17 * 60) * 60;
      const event: DirectorEvent = { applyT, type: "end_of_life_start", params: { residentId: r.id, expectedDays }, origin };
      if (applyT <= fromT || r.busy || opts.endOfLifeOn) continue;
      const capped = majorAllowed(config, memory.majorTs, applyT);
      if (capped) {
        suppressed.push({ event, reason: capped });
        continue;
      }
      memory.majorTs.push(applyT);
      planned.push(event);
      opts.endOfLifeOn = true;
    }
  }

  // 7. Visitors' missed weeks (sub-milestone d): on Mondays, and on the first day for the rest of
  //    that week. Not scaled by the day type: visitors' lives go on regardless. Drawn from their
  //    own stream (`visitorRng`), so the rest of the plan is the same with or without them.
  if (opts.visitors && opts.visitorRng && (day % 7 === 0 || fromT > dayStart)) {
    const vr = opts.visitorRng;
    const month = simDate(dayStart).month;
    for (const v of opts.visitors) {
      if (v.staying || v.reliability < config.visitors.regular_from_reliability) continue;
      if (!vr.chance(weekOffChance(config, month, v.reliability))) continue;
      const cause = drawCause(config, month, vr.next());
      planned.push({ applyT: fromT + 60, type: "visitor_week_off", params: { visitorId: v.id, cause }, origin });
    }
  }

  planned.sort((a, b) => a.applyT - b.applyT);
  return { dayType, downgradedFrom, planned, suppressed };
}

/** A cause's month factor, normalised so its mean over the year is 1. */
function monthFactor(config: DirectorConfig, cause: WeekOffCause, month: number): number {
  const months = config.visitors.causes[cause].months ?? {};
  const f = (m: number) => months[String(m)] ?? 1;
  let sum = 0;
  for (let m = 1; m <= 12; m++) sum += f(m);
  return f(month) / (sum / 12);
}

/** The share of a regular visitor's weeks they miss on average: `weeks_off_per_year / 52`, at most 1 - reliability. */
export function weekOffShare(config: DirectorConfig, reliability: number): number {
  return Math.min(config.visitors.weeks_off_per_year / 52, 1 - reliability);
}

/** The chance a regular visitor misses a week starting in `month` (seasonal, at most 1 - reliability). */
export function weekOffChance(config: DirectorConfig, month: number, reliability: number): number {
  const seasonal = WEEK_OFF_CAUSES.reduce((s, c) => s + config.visitors.causes[c].share * monthFactor(config, c, month), 0);
  return Math.min(weekOffShare(config, reliability) * seasonal, 1 - reliability);
}

/** Which cause, weighted by each cause's share and its month factor. */
function drawCause(config: DirectorConfig, month: number, u: number): WeekOffCause {
  const weights = WEEK_OFF_CAUSES.map((c) => config.visitors.causes[c].share * monthFactor(config, c, month));
  let roll = u * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < WEEK_OFF_CAUSES.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return WEEK_OFF_CAUSES[i]!;
  }
  return WEEK_OFF_CAUSES[WEEK_OFF_CAUSES.length - 1]!;
}

function sundowning(r: ResidentRisk, hour: number, hours: number): boolean {
  if (r.sundownOnset === null) return false;
  const from = Math.floor(r.sundownOnset / 3600);
  return ((hour - from + 24) % 24) < hours;
}

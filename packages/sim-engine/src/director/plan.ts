// The director's daily plan from base rates (docs/10). Pure: given the tuning, a random stream,
// the day's roster and the residents, it draws the day type, sick calls and no-shows, and falls,
// then applies the pacing caps. The engine calls it at 00:00 (and at the start); the rates
// script calls it on its own to measure realised rates over many years.

import { DISEASES, SECONDS_PER_DAY, clockToSeconds, simDate, type DayType, type DirectorConfig, type Resident, type ShiftName } from "@vch/shared-types";
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
  return { id: r.id, risk: r.mobility.falls_risk, bedBound: r.care.bed_bound, sundownOnset: onset ? clockToSeconds(onset) : null };
}

/** Is this a major event (docs/10 pacing)? In sub-milestone (a) only a serious fall is. */
export function isMajor(e: Pick<DirectorEvent, "type" | "params">): boolean {
  return (e.type === "inject_fall" && (e.params as { severity: string }).severity === "serious") || e.type === "infection_case";
}

/** Whether a major event at `t` keeps to the caps, given the majors already planned or applied. */
export function majorAllowed(config: DirectorConfig, majorTs: number[], t: number): string | null {
  const day = Math.floor(t / SECONDS_PER_DAY);
  const sameDay = majorTs.filter((m) => Math.floor(m / SECONDS_PER_DAY) === day).length;
  if (sameDay >= config.pacing.max_major_per_day) return "major-event cap: one a day";
  if (majorTs.some((m) => Math.abs(m - t) < config.pacing.min_hours_between_major * 3600)) return `major-event cap: ${config.pacing.min_hours_between_major} h apart`;
  return null;
}

export function planRandomDay(config: DirectorConfig, rng: Rng, memory: PlanMemory, day: number, fromT: number, roster: RosterEntry[], residents: ResidentRisk[]): DayPlan {
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
    const perDay = (falls.per_resident_year / 365) * (factor(r) / meanFactor) * rate;
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

  planned.sort((a, b) => a.applyT - b.applyT);
  return { dayType, downgradedFrom, planned, suppressed };
}

function sundowning(r: ResidentRisk, hour: number, hours: number): boolean {
  if (r.sundownOnset === null) return false;
  const from = Math.floor(r.sundownOnset / 3600);
  return ((hour - from + 24) % 24) < hours;
}

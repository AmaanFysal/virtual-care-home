// The scenario director (docs/10): its tuning file (data/director.json), scripted scenario files
// (data/scenarios/*.json) and the settings a run is started with.

import type { ClockTime, Weekday } from "./data.js";
import type { InputPayloads, InputType } from "./events.js";

export type DayType = "ordinary" | "busy" | "hard";

/** How a missing shift is covered: "auto" tries bank, then agency; the others force one outcome. */
export type CoverChoice = "auto" | "bank" | "agency" | "none";
export type AbsenceReason = "sick" | "no_show" | "went_home_sick";
export type Disease = "norovirus" | "flu";
export const DISEASES: readonly Disease[] = ["norovirus", "flu"];

/** One disease's natural history and how it spreads (docs/10 "Infection routes"). Hours are ranges drawn per case. */
export interface DiseaseConfig {
  /** Introductions from outside (a visitor, a new admission, staff) a winter (Nov to Mar) and over the rest of the year. */
  per_winter: number;
  per_summer: number;
  incubation_hours: [number, number];
  symptomatic_hours: [number, number];
  /** Infectious from this long before symptoms until this long after they end. */
  infectious_before_symptoms_hours: number;
  infectious_after_symptoms_hours: number;
  /** A resident stays isolated until this long after symptoms end; staff stay off until this long after. */
  isolation_after_symptoms_hours: number;
  staff_exclusion_after_symptoms_hours: number;
  /** Weight of each route (0..1): norovirus mostly contact, flu mostly airborne. */
  routes: { contact: number; airborne: number };
}
export const COVER_CHOICES: readonly CoverChoice[] = ["auto", "bank", "agency", "none"];
/** Rota slots a sick call or no-show can hit. */
export const ROTA_SLOTS = ["early.lead", "early.ca", "late.lead", "late.ca", "night.carer", "rn_day.nurse"] as const;

/** data/director.json: base rates, context modifiers and pacing. Every number has its source in docs/10. */
export interface DirectorConfig {
  version: 1;
  /** Each day's type is drawn first; `rate` scales every base rate that day (weighted mean about 1). */
  day_types: Record<DayType, { p: number; rate: number }>;
  pacing: {
    max_major_per_day: number;
    min_hours_between_major: number;
    max_hard_days_per_week: number;
    max_absences_per_day: number;
    /** Sub-milestone (b): no new outbreak within this many days of the last one ending. */
    outbreak_quiet_days: number;
  };
  falls: {
    /** Falls per resident per year across the wing. */
    per_resident_year: number;
    /** Share of falls with a serious injury (a major event). */
    serious_share: number;
    /** Multipliers by the card's `mobility.falls_risk`; they share out the wing's rate, not add to it. */
    risk: Record<"high" | "medium" | "low", number>;
    bed_bound: number;
    /** Relative weight of each hour 00..23. */
    hour_weights: number[];
    /** Residents who sundown: this factor for `hours` from their onset. */
    sundowning: { hours: number; factor: number };
    /** During a shift with a planned absence. */
    short_staffed: number;
  };
  absence: {
    /** Rota slots whose holders can call in sick. */
    slots: string[];
    /** Months (1..12) with the winter factor. */
    winter_months: number[];
    winter_factor: number;
    /** A sick call comes this many minutes before the shift starts. */
    call_mins_before: [number, number];
    /** Chance per agency shift that the booked worker doesn't turn up. */
    agency_no_show: number;
    /** Chance each free bank carer says yes. */
    bank_accept: number;
    bank_travel_mins: [number, number];
    /** Chance an agency worker can be found at short notice. */
    agency_available: number;
    /** An agency worker arrives this long after the booking. */
    agency_arrival_mins: [number, number];
  };
  /**
   * Infection spread (sub-milestone b). Each route gives its own chance per exposure, scaled by the
   * disease's weight; they combine as p = 1 - product(1 - p_route). The airborne route is a proxy
   * (time in the same room as someone infectious) until the air model replaces it in the same slot.
   */
  infection: {
    diseases: Record<Disease, DiseaseConfig>;
    /** Contact: a chance per minute within `within_m` of someone infectious (care, sitting together). */
    contact: { p_per_minute: number; within_m: number };
    /** Airborne (proxy): a chance per hour in the same room as someone infectious. */
    airborne_proxy: { p_per_hour_same_room: number };
    /** Multipliers on each route between an isolated resident and anyone with them (gloves and aprons; masks). */
    ppe: { contact: number; airborne: number };
    /** Extra minutes per care visit to an isolated resident (putting PPE on and off). */
    ppe_extra_mins: number;
    /**
     * Per disease, as UK guidance has it (citations in data/director.json):
     * - declared at `cases` cases within `within_hours`, counting residents and staff (norovirus: 2
     *   within 48 hours) or residents only (flu: 2 within 5 days; staff cases managed and logged but
     *   not counted towards declaring or ending it);
     * - over `hours` after the last counted case's onset or recovery (norovirus: 48 h after the last
     *   case is symptom-free and at least 72 h after the last onset; flu: 5 days after the last
     *   onset), and never while a counted case is still ill.
     */
    outbreak: {
      declare: Record<Disease, { cases: number; within_hours: number; count: "residents_and_staff" | "residents"; note?: string }>;
      end: Record<Disease, { hours: number; after: "onset" | "recovery"; min_after_onset_hours?: number; note?: string }>;
    };
    /** Share of introductions that start with a member of staff (the rest with a resident). */
    index_staff_share: number;
  };
  /** Rates and parameters for later sub-milestones, kept here so they can be tuned without code. */
  later: Record<string, unknown>;
}

/** One scripted event. `day` is the first such weekday on or after the run start (plus `week` weeks). */
export interface ScenarioEvent<K extends InputType = InputType> {
  day?: Weekday;
  week?: number;
  time?: ClockTime;
  /** Absolute sim time instead of day and time. */
  t?: number;
  type: K;
  params: InputPayloads[K];
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** Also run the random director alongside the script. */
  random: boolean;
  events: ScenarioEvent[];
}

/** How a run uses the director. Off unless given. */
export interface DirectorSettings {
  config: DirectorConfig;
  /** Random events from the base rates. */
  random: boolean;
  scenario?: Scenario;
  /** Deaths and end-of-life decline (sub-milestone c); off for the public demo. Default on. */
  deaths?: boolean;
}

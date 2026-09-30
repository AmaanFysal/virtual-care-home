// The scenario director (docs/10): its tuning file (data/director.json), scripted scenario files
// (data/scenarios/*.json) and the settings a run is started with.

import type { ClockTime, Weekday } from "./data.js";
import type { InputPayloads, InputType } from "./events.js";

export type DayType = "ordinary" | "busy" | "hard";

/** How a missing shift is covered: "auto" tries bank, then agency; the others force one outcome. */
export type CoverChoice = "auto" | "bank" | "agency" | "none";
export type AbsenceReason = "sick" | "no_show";
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

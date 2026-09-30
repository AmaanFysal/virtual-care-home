// The scenario director (docs/10): its tuning file (data/director.json), scripted scenario files
// (data/scenarios/*.json) and the settings a run is started with.

import type { ClockTime, Resident, Visitor, Weekday } from "./data.js";
import type { InputPayloads, InputType } from "./events.js";

export type DayType = "ordinary" | "busy" | "hard";

/** How a missing shift is covered: "auto" tries bank, then agency; the others force one outcome. */
export type CoverChoice = "auto" | "bank" | "agency" | "none";
export type AbsenceReason = "sick" | "no_show" | "went_home_sick";
export type Disease = "norovirus" | "flu";
export const DISEASES: readonly Disease[] = ["norovirus", "flu"];

export type IllnessKind = "chest_infection" | "uti" | "dehydration";
export const ILLNESS_KINDS: readonly IllnessKind[] = ["chest_infection", "uti", "dehydration"];
/** Why someone went to hospital (sets how long they stay and what changes when they're back). */
export type HospitalCause = IllnessKind | "serious_fall";

/** Illness, hospital, end of life and admissions (sub-milestone c). Every number has its source in the `note` fields. */
export interface HealthConfig {
  /** Unplanned (emergency) hospital admissions per resident per year, all causes; falls give their own share. */
  admissions_per_resident_year: number;
  illness: {
    /** Share of illness-driven admissions by kind, and each kind's winter factor (the year's average stays 1). */
    kinds: Record<IllnessKind, { share: number; winter_factor: number }>;
    /** Share of illness episodes that are severe (GP, then hospital); the rest are looked after at home. */
    severe_share: number;
    /** A mild illness lasts this many days: rest in their room, checks at least every `check_interval_mins`, drinks at every check, falls risk × `falls_factor`. */
    mild_days: [number, number];
    check_interval_mins: number;
    falls_factor: number;
    /** A severe one: the GP within these hours, then 999 for an ambulance. */
    gp_hours: [number, number];
  };
  /** Days in hospital by cause, from sources (`note`). */
  stay_days: Record<HospitalCause, [number, number]>;
  /** Back from hospital: falls risk × `falls_factor` for `weeks`, and care-profile changes by cause. */
  after_return: {
    falls_factor: number;
    weeks: number;
    changes: Record<HospitalCause, { walk_speed_factor?: number; falls_risk_up?: boolean; personal_care_staff?: number; weeks: number | null }>;
  };
  end_of_life: {
    /** Deaths per resident per year (through a planned end-of-life decline). */
    deaths_per_resident_year: number;
    /** How much likelier a resident already on an end-of-life care plan is to be the one. */
    end_of_life_weight: number;
    expected_days: [number, number];
    /** The last days: in bed, comfort care (mouth care and sips) at this interval. */
    final_days: number;
    comfort_interval_mins: number;
    /** Checks during the decline (usual end-of-life practice: hourly), then in the last days. */
    check_interval_mins: number;
    final_check_interval_mins: number;
  };
  /** A new resident moves in this many weeks after a death, if a reviewed card is waiting. */
  admission_weeks_after_death: [number, number];
}

/** A new resident's card (data/personas/admissions.json), with their family. Used only once reviewed. */
export interface AdmissionCard {
  id: string;
  status: "draft" | "reviewed";
  /** `room` is left empty: they get the first empty room when they move in. */
  resident: Resident;
  visitors: Visitor[];
}

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
  health: HealthConfig;
  visitors: VisitorWeeksConfig;
  celebrations: CelebrationsConfig;
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

// ---------------------------------------------------------------- visitors and celebrations (d)

export const WEEK_OFF_CAUSES = ["holiday", "illness", "family"] as const;
export type WeekOffCause = (typeof WEEK_OFF_CAUSES)[number];

/**
 * A regular visitor's missed weeks (sub-milestone d). With the random director on, lead visitors
 * whose reliability is at least `regular_from_reliability` miss about `weeks_off_per_year` whole
 * weeks a year, each with a cause (seasonal by month), never more than 1 - reliability of their
 * weeks; their other weeks are scaled up so they visit as often as before on average. Occasional
 * visitors (Gary, Tunde, Colin...) keep their pattern: their quiet weeks are how they visit.
 */
export interface VisitorWeeksConfig {
  regular_from_reliability: number;
  weeks_off_per_year: number;
  /** Each cause's share of missed weeks, and a factor by month (1..12, default 1; normalised over the year). */
  causes: Record<WeekOffCause, { share: number; months?: Record<string, number> }>;
  note?: string;
}

export type CelebrationKind = "birthday" | "festival";

/**
 * Birthdays (from each resident's dob) and festivals (from their faith). On the day: every lead
 * visitor comes with their usual chance plus `visit_chance_add` (up to `visit_chance_max`),
 * companions with at least `companion_chance`, arriving in `arrive` and staying `duration_factor`
 * times as long; tea and cake from `tea[0]` to `tea[1]`, in the Lounge (or in their room for
 * someone who doesn't use it), led by Bev when she's on. No gathering during an outbreak.
 */
export interface CelebrationsConfig {
  visit_chance_add: number;
  visit_chance_max: number;
  companion_chance: number;
  arrive: [ClockTime, ClockTime];
  duration_factor: number;
  min_duration_mins: number;
  tea: [ClockTime, ClockTime];
  /** Faith groups, by words in a card's `faith` (lower case). */
  faiths: Record<string, string[]>;
  festivals: FestivalConfig[];
  note?: string;
}

export interface FestivalConfig {
  name: string;
  /** "any" (everyone, faith or none), or faith groups from `faiths`. */
  for: "any" | string[];
  /** A fixed date "MM-DD", "easter" (Western Easter Sunday), or a list of dates "YYYY-MM-DD". */
  date: string | string[];
  note?: string;
}

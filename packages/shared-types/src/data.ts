// Shapes of the static data files in `data/`. Field names mirror the JSON (snake_case),
// following the schema examples in docs/research/plan-v2.md. See docs/02 and docs/06.

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export const WEEKDAYS: readonly Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "HH:MM", 24-hour clock. */
export type ClockTime = string;
export type Gender = "female" | "male";

// ---------------------------------------------------------------- floor plan

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** "lounge" is the residents' day and dining room; "waiting" is for visitors only. */
export type RoomKind = "bedroom" | "corridor" | "lounge" | "waiting" | "reception" | "staff";

export interface Room {
  id: string;
  name: string;
  kind: RoomKind;
  rect: Rect;
  floor_area_m2: number;
  ceiling_height_m: number;
  notes?: string;
}

export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A gap in a wall. `rooms` are the two spaces it connects; "Outside" is off the map. */
export interface Door {
  id: string;
  wall: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  rooms: [string, string];
}

export type FurnitureKind = "bed" | "desk" | "table" | "chair" | "armchair" | "sofa" | "wc" | "tv" | "bookshelf";

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  room: string;
  rect: Rect;
  label?: string;
  /** Beds, desks, tables, sofas, TVs and bookshelves block movement; chairs, armchairs and WCs do not. */
  blocks: boolean;
}

/** "wheelchair": where a hoisted resident sits in their own wheelchair by the bed (Raj); no chair there, and nobody else uses it. */
export type PointKind = "bed" | "bedside" | "chair" | "wheelchair" | "wc" | "seat" | "desk" | "waypoint" | "exit";

export interface NamedPoint {
  id: string;
  kind: PointKind;
  room: string;
  x: number;
  y: number;
}

export interface FloorPlan {
  version: number;
  units: "m";
  size: { w: number; h: number };
  grid_cell_m: number;
  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  furniture: Furniture[];
  points: NamedPoint[];
}

// ---------------------------------------------------------------- personas

export interface BigFive {
  openness?: number;
  conscientiousness?: number;
  extraversion?: number;
  agreeableness?: number;
  neuroticism?: number;
}

/** Mechanical care fields the rules read. See docs/05 "Resident care profiles". */
export type LoungeActivity = "tv" | "reading" | "puzzles" | "chatting";

export interface LoungePrefs {
  /** Has lunch at the Lounge dining table (otherwise in their room). */
  lunch: boolean;
  /** Stays for afternoon tea (15:00) in the Lounge. */
  tea: boolean;
  /** Needs a carer to walk them there and back. */
  escort: boolean;
  /** What they like to do there, most liked first. */
  likes: LoungeActivity[];
}

export interface ResidentCare {
  /** Staff needed for washing and dressing. */
  personal_care_staff: 1 | 2;
  personal_care_mins: number;
  /** Staff needed to move between bed, chair and toilet; 0 means independent. */
  transfer_staff: 0 | 1 | 2;
  transfer_method: "independent" | "standby" | "hoist" | "none";
  bed_bound: boolean;
  female_carers_only: boolean;
  check_interval_mins: { day: number; night: number };
  /** Null when the resident repositions themselves. */
  reposition_interval_mins: { day: number | null; night: number | null };
  /** False when the resident cannot ask for help (relies on checks). */
  can_request_help: boolean;
  toileting: "independent" | "prompted" | "assisted" | "in_bed";
  prompted_toileting_hours?: number;
  eating_support: "independent" | "prompting" | "assisted" | "mouth_care_only";
  shower_day?: Weekday;
  glucose_check_before_breakfast?: boolean;
  night_wandering?: boolean;
  /** Medication that must be given on time (Parkinson's): first on every round. */
  time_critical_meds?: boolean;
  /** End-of-life comfort care (mouth care and sips) at least this often; required for mouth_care_only. */
  mouth_care_interval_mins?: number;
  /** Lounge habits for residents who can walk there; absent means they stay in their room. */
  lounge?: LoungePrefs;
  /** Visitor id phoned after a fall. */
  next_of_kin: string;
}

export interface Resident {
  id: string;
  name: { first: string; known_as: string; last: string };
  gender: Gender;
  dob: string;
  /** Bed point id, e.g. "Room1.BedA". */
  room: string;
  admitted: string;
  origin: string;
  faith?: string;
  languages?: string[];
  conditions: string[];
  life_story: string[];
  personality: BigFive;
  speech_style: string;
  cognition: {
    diagnosis: string | null;
    stage: string | null;
    capacity: { daily_choices: boolean; finances: boolean; treatment: string };
    memory_profile: {
      recent_retention_hours: number | null;
      time_anchor_at_dusk: number | null;
      misidentification_rate: number;
    };
    sundowning: { onset: ClockTime; severity: number } | null;
    hallucinations?: string;
  };
  mobility: {
    aid: string;
    transfer: string;
    falls_risk: "low" | "medium" | "high";
    /** 0 for non-ambulant residents. */
    walk_speed_mps: number;
  };
  continence: string;
  nutrition: {
    diet: string;
    fluids_target_ml: number;
    fluid_limit_ml?: number;
    likes: string[];
    dislikes: string[];
  };
  medication_rounds: ClockTime[];
  routine: { wake: ClockTime | null; bed: ClockTime | null; nap: ClockTime | null };
  preferences: string[];
  legal: { dnacpr: boolean; dnacpr_note?: string; lpa_health: string | null; dols: string | null };
  staff_relationships: { staff: string; trust: number; note?: string }[];
  goals: string[];
  triggers: string[];
  care: ResidentCare;
}

export type StaffRole =
  | "wing_manager"
  | "registered_nurse"
  | "senior_carer"
  | "care_assistant"
  | "activities_coordinator"
  | "receptionist";

/** Competencies the rules check. Others are narrative. */
export type Competency =
  | "meds_trained"
  | "fall_assessment"
  | "moving_handling"
  | "moving_handling_trainer"
  | "dementia_level2"
  | "end_of_life_care"
  | "first_aid"
  | "care_certificate_in_progress";

export interface Staff {
  id: string;
  name: string;
  gender: Gender;
  age: number;
  role: StaffRole;
  /** Bank staff are the home's own flexible pool: they know the residents but have no fixed hours. */
  employment: "permanent" | "bank";
  experience_years: number;
  prior?: string;
  origin?: string;
  competencies: Competency[];
  contract: { hours_per_week: number; patterns: string[]; sickness_propensity: number };
  personality: BigFive;
  stress: { baseline: number; rises_with: string[]; coping: string };
  care_style: string;
  walk_speed_mps: number;
  relationships: { with: string; type?: string; tension?: number; rapport?: number; note?: string }[];
}

export interface VisitPattern {
  days: Weekday[];
  /** "HH:MM-HH:MM": the window in which the visitor arrives. */
  time_window: string;
  duration_mins: number;
  /** Probability of visiting on each listed day. */
  reliability: number;
}

export interface Visitor {
  id: string;
  name: string;
  gender: Gender;
  age: number;
  relation_to_resident: { resident: string; type: string }[];
  personality: BigFive;
  visit_pattern: VisitPattern;
  /** Visits only together with this visitor (on the listed days, with this reliability), arriving and leaving together. */
  accompanies?: string;
  visit_behaviours: string[];
  /** May help the resident eat during a protected mealtime (Kuldip with Raj). */
  may_help_at_meals?: boolean;
  conflicts: { with: string; issue: string; intensity: number }[];
  walk_speed_mps: number;
}

export interface Relationship {
  from: string;
  to: string;
  type: string;
  closeness?: number;
  tension?: number;
  history?: string[];
  live_issues?: string[];
}

// ---------------------------------------------------------------- rota

export type ShiftName = "early" | "late" | "night" | "rn_day" | "office" | "reception";

/** Placeholder in the rota for a slot filled by a generated agency worker. */
export const AGENCY = "AGENCY" as const;
export type RotaSlot = string; // staff id or AGENCY

export interface RotaDay {
  early: { lead: RotaSlot; ca: RotaSlot };
  late: { lead: RotaSlot; ca: RotaSlot };
  /** The night shift that starts on this day's evening. */
  night: { carer: RotaSlot };
  rn_day: { nurse: RotaSlot };
  office: string[];
  reception: string[];
}

export interface AgencyWorker {
  name: string;
  gender: Gender;
}

export interface Rota {
  version: number;
  shifts: Record<ShiftName, { start: ClockTime; end: ClockTime }>;
  week: Record<Weekday, RotaDay>;
  agency_pool: { carer: AgencyWorker[]; nurse: AgencyWorker[] };
  /** Female carer from the main building who visits at night on planned rounds (docs/05). */
  night_float: { id: string; name: string; gender: Gender; rounds: ClockTime[] };
}

// ---------------------------------------------------------------- bundle

export interface WorldData {
  floorplan: FloorPlan;
  residents: Resident[];
  staff: Staff[];
  visitors: Visitor[];
  relationships: Relationship[];
  rota: Rota;
}

// Engine-internal world state. Plain serialisable data (no callbacks), iterated in id order.

import type {
  AbsenceReason,
  AnySimEvent,
  Badge,
  Competency,
  Gender,
  LoungeActivity,
  NamedPoint,
  NeedName,
  PersonKind,
  Visitor,
  Posture,
  Resident,
  ShiftName,
  DayType,
  AdmissionCard,
  DirectorConfig,
  DirectorSettings,
  Disease,
  HospitalCause,
  IllnessKind,
  InputPayloads,
  InputType,
  SimInput,
  StaffRole,
  WorldData,
  CelebrationKind,
  WeekOffCause,
} from "@vch/shared-types";
import type { BtState } from "./bt.js";
import type { Rng, StreamName } from "./rng.js";
import type { Grid } from "./world/grid.js";

export interface Move {
  destPointId: string;
  /** Grid cells to walk through, ending at the standing cell chosen for the destination. */
  cells: number[];
  /** Index into `cells` of the next waypoint. */
  next: number;
  /** Exact end position: the point itself, or the centre of the free cell next to it. */
  endX: number;
  endY: number;
}

export interface ShiftAssignment {
  personId: string;
  shift: ShiftName;
  /** Rota slot, e.g. "early.lead", "rn_day.nurse", "office". */
  slot: string;
  arriveT: number;
  startT: number;
  endT: number;
  /** Set when the person has been spawned at the exit door (or placed at start). */
  spawned: boolean;
  started: boolean;
  ended: boolean;
  /** The late carer staying on to cover a night nobody else could (docs/10): already on the map. */
  stayOn?: boolean;
}

/** A shift someone won't work (docs/10), kept to explain missed service targets. */
export interface Absence {
  staffId: string;
  name: string;
  slot: string;
  shift: ShiftName;
  reason: AbsenceReason;
  startT: number;
  endT: number;
  cover: { kind: "bank" | "agency" | "main_building"; staffId: string; name: string; arriveT: number } | null;
  /** The late carer who stayed on until the cover arrived, so the shift was never short. */
  bridgedBy?: string;
}

/** An event the director has planned, applied at `applyT` like any input (source "director"). */
export interface DirectorEvent<K extends InputType = InputType> {
  applyT: number;
  type: K;
  params: InputPayloads[K];
  origin: string;
}

export interface DirectorState {
  settings: DirectorSettings;
  /** Planned events, by apply time. */
  queue: DirectorEvent[];
  /** Scripted events not yet planned (each is planned on its day). */
  script: DirectorEvent[];
  dayTypes: Map<number, DayType | "scripted">;
  /** Times of major events, planned or applied (pacing). */
  majorTs: number[];
  /** No new infection is introduced before this (an outbreak on, or ended less than 14 days ago). */
  quietUntil: number;
}

export interface StaffState {
  role: StaffRole | "agency_carer" | "agency_nurse" | "paramedic" | "main_building_carer";
  competencies: Competency[];
  /** "staying" means the shift has ended but they can't leave yet (task or floor cover). */
  duty: "off" | "arriving" | "on_shift" | "staying" | "leaving";
  shift: ShiftAssignment | null;
  taskId: string | null;
  /** Break task paused to deal with something urgent (sole night carer). */
  pausedBreakId: string | null;
  breakDueT: number | null;
  breakTaken: boolean;
  /** 0..1, rolling share of time spent on tasks (about an hour's memory). */
  workload: number;
}

export interface ResidentState {
  data: Resident;
  needs: Record<NeedName, number>;
  asleep: boolean;
  /** In bed (at the bed point) rather than standing or sitting somewhere. */
  inBed: boolean;
  /** Open help request task, if any. */
  requestId: string | null;
  /** Task currently being done with or for this resident (assist, own trip to the WC). */
  busyTaskId: string | null;
  fluidsMlToday: number;
  /** When a drink was left by their bed or chair (asleep or busy); drunk when they're free, stale after 2 hours. */
  drinkLeftT: number | null;
  /** A left drink went stale: the next member of staff with them replaces it. */
  drinkStale: boolean;
  /** Someone who needs help to drink missed a drink (asleep or busy): it's given at the next contact while awake. */
  drinkOwed: boolean;
  /** When they woke for the day (first seen awake after their wake time); null until then. */
  wokeT: number | null;
  /** Tea on waking given today (and toast, for early risers). */
  teaDone: boolean;
  toastDone: boolean;
  /** Last mouth care or sips (end-of-life comfort care, Dennis). */
  lastMouthCareT: number;
  /** What they're doing in the Lounge, if they're there. */
  loungeActivity: LoungeActivity | null;
  /** A fall in progress: the resident stays on the floor until it has been assessed. */
  fall: {
    t: number;
    severity: "minor" | "serious";
    assessed: boolean;
    taskId: string;
    /** Since when nobody has been with them or on their way, and no help has been asked for (the `fall_unattended` invariant). */
    uncoveredSinceT: number | null;
  } | null;
  /** Post-fall observations: checks every 30 minutes until this time. */
  postFallUntil: number;
  /** Off the wing (conveyed to hospital); the bed is kept. */
  away: "hospital" | "died" | null;
  /** When they come back from hospital, and why they went (sets the stay and what changes after). */
  returnT: number | null;
  leftForHospitalT: number | null;
  hospitalCause: HospitalCause | null;
  /** Falls risk is raised until then (back from hospital, docs/10). */
  recentReturnUntil: number;
  /** An illness (docs/10): mild (rest in their room, extra checks, fluids pushed) or severe (GP, then hospital). */
  illness: { kind: IllnessKind; severity: "mild" | "severe"; startT: number; endT: number; gpT: number | null; checkMins: number } | null;
  /**
   * Changes to their care profile, applied to their card in this run (`data`) and ended at `untilT`
   * (null: lasting). Walking speed, falls risk and staff for personal care are always the values
   * before the first change (`careBase`) with every change still on applied, so changes that
   * overlap end in any order.
   */
  overrides: { reason: string; changes: string[]; untilT: number | null; ended: boolean; effect: { speedFactor?: number; fallsUp?: boolean; twoStaff?: boolean } }[];
  careBase: { speed: number; fallsRisk: Resident["mobility"]["falls_risk"]; personalCareStaff: 1 | 2 } | null;
  /** Their end-of-life decline: death is expected at `deathT`; from `finalFromT` they're in bed on comfort care. */
  endOfLife: { startT: number; deathT: number; finalFromT: number; final: boolean; checkMins: number } | null;
  /** Last time a member of staff saw them (a check or any care with them). */
  lastCheckedT: number;
  lastToiletT: number;
  lastTurnedT: number;
  /** Per care-day flags, reset at 04:00. */
  morningDone: boolean;
  bedtimeDone: boolean;
  mealsServed: string[];
}

/** The floating night carer from the main building (spec decision 16). */
export interface FloatState {
  status: "off" | "coming" | "on_site" | "leaving";
  arriveT: number | null;
  planned: boolean;
}

export type TaskKind = "assist" | "handover" | "briefing" | "break" | "self_toilet" | "self_move" | "care" | "round" | "med_round" | "fall" | "let_in" | "idle" | "lounge_check" | "hospital_transfer";

/** A visitor's progress through a visit (docs/05 "Visiting"). */
export interface VisitorState {
  data: Visitor;
  residentId: string;
  /** Lead visitor for companions who only come with someone (the Sandhu grandchildren). */
  leadId: string | null;
  phase: "home" | "outside" | "at_door" | "entering" | "signing_in" | "to_resident" | "waiting" | "visiting" | "signing_out" | "leaving";
  arriveT: number | null;
  durationMins: number;
  visitStartT: number | null;
  /** When the current step (signing in or out) started. */
  stepT: number | null;
  /** Days (day index since the epoch) this week's visits fall on, from the weekly quota. */
  weekDays: number[];
  /** Missing this week (docs/10, sub-milestone d): no visits until `untilDay`. */
  weekOff: { cause: WeekOffCause; untilDay: number } | null;
}

/** A birthday or festival today (docs/10, sub-milestone d). */
export interface Celebration {
  day: number;
  kind: CelebrationKind;
  name: string;
  residentIds: string[];
  /** False during an outbreak: no gathering, no extra visits, no tea. */
  gathering: boolean;
  teaFrom: number;
  teaUntil: number;
  tea: "pending" | "on" | "done";
  /** Where tea is, and everyone who came to it (logged when it's over). */
  teaRoom: string | null;
  came: { residents: string[]; visitors: string[] };
}

/** Scheduled care done at the bedside (or chair). */
/** tea: tea on waking (with toast for early risers); comfort: mouth care and sips; escort: walk them to or from the Lounge. */
export type CareKind = "morning" | "bedtime" | "check" | "reposition" | "meal" | "pad_change" | "tea" | "comfort" | "escort";

export interface Task {
  id: string;
  kind: TaskKind;
  label: string;
  residentId: string | null;
  need: NeedName | null;
  createdT: number;
  startedT: number | null;
  staffNeeded: 1 | 2;
  femaleOnly: boolean;
  /** Base utility before urgency, waiting time and distance (docs/04). */
  priority: number;
  /** A resident's own help request (as opposed to scheduled care). */
  request: boolean;
  /** Help must have started by this time (spec: wait-time rule), or the scheduled time it is due. */
  deadlineT: number | null;
  /** For handovers and briefings: the only people who may take this task. */
  members: string[] | null;
  assigned: string[];
  status: "open" | "active" | "paused" | "done";
  bt: BtState;
  /** Task-specific numbers and ids (break minutes left, handover roles, ...). */
  data: Record<string, number | string | string[] | null>;
}

/** Counters since the last handover, passed on in its summary. */
export interface ShiftLog {
  falls: number;
  lateOrMissedDoses: number;
  helpRequests: number;
  checksDone: number;
}

/**
 * One person's infection (docs/10), kept on the person so the future air model can read who is
 * infectious and where. All times are sim seconds, drawn when they're exposed.
 */
export interface Infection {
  disease: Disease;
  exposedT: number;
  route: "contact" | "airborne (proxy)" | "introduced";
  infectiousFromT: number;
  symptomaticFromT: number;
  symptomsEndT: number;
  infectiousUntilT: number;
  /** Residents: isolated in their room until then. Staff: off work until then. */
  isolatedUntilT: number;
  /** Which of those have happened (and been logged). */
  symptomatic: boolean;
  recovered: boolean;
  isolated: boolean;
}

/** An outbreak of one disease: declared at 2 cases within 48 hours, over after 48 hours with no new case. */
export interface Outbreak {
  disease: Disease;
  declaredT: number;
  lastCaseT: number;
  cases: string[];
  /** When each counted case's symptoms end (kept here: agency workers leave the world after their shift). */
  caseEndTs: number[];
  overT: number | null;
}

export interface Person {
  id: string;
  kind: PersonKind;
  name: string;
  initials: string;
  gender: Gender;
  /** Walking speed in m/s; 0 for residents moved by staff. */
  speed: number;
  onMap: boolean;
  x: number;
  y: number;
  roomId: string | null;
  posture: Posture;
  badges: Badge[];
  task: string | null;
  move: Move | null;
  /** Named point the person is at (or at the nearest free cell to), if any. */
  atPoint: string | null;
  /** Grid cell this person has claimed to stand on (see docs/04 "Standing spots"). */
  standCell: number | null;
  /** Doorway zone this person currently occupies. */
  heldZone: string | null;
  /** Doorway zone this person is waiting to enter. */
  waitingAtDoor: string | null;
  staff: StaffState | null;
  resident: ResidentState | null;
  visitor: VisitorState | null;
  /** Residents and staff only; null when never infected. Once recovered they're immune for the run. */
  infection: Infection | null;
}

/** How a door's set state is decided (v1.0-testbed, building.ts). */
export type DoorRule =
  | { kind: "bedroom"; roomId: string }
  | { kind: "ensuite"; roomId: string }
  | { kind: "held_open" }
  | { kind: "closed" }
  | { kind: "locked" };

/**
 * The building's state (v1.0-testbed): doors and windows as the building's rules set them. Written
 * only by `observeBuilding`, last in each tick, and read by nothing that decides what people do.
 */
export interface BuildingState {
  doors: Map<string, { rule: DoorRule; state: "open" | "ajar" | "closed" | "locked"; rooms: [string, string] }>;
  windows: Map<string, { roomId: string; open: boolean; openedT: number | null }>;
  /** Residents whose night has begun (from going to bed until they wake for the day). */
  night: Set<string>;
  /** Residents moved by hoist this tick (the transfer is instant): their activity this tick. */
  hoisted: Set<string>;
  /** The day (index since the epoch) each window was last opened: at most once a day. */
  openedToday: Map<string, number>;
}

export interface World {
  seed: string;
  startT: number;
  tick: number;
  t: number;
  data: WorldData;
  grid: Grid;
  points: Map<string, NamedPoint>;
  rng: Record<StreamName, Rng>;
  people: Map<string, Person>;
  /** Person ids in ascending order (the processing order). */
  order: string[];
  shifts: ShiftAssignment[];
  plannedDays: Set<number>;
  /** People due to appear at the exit door once the doorway is clear, in queue order. */
  spawnQueue: string[];
  zoneOwner: Map<string, string>;
  /** Tick in which each doorway zone was last released; it stays closed for the rest of that tick. */
  zoneReleasedTick: Map<string, number>;
  /** Standing cells claimed by stationary people or people walking to them. */
  standClaims: Map<number, string>;
  /**
   * Display only: the turning points each person passed this tick, in order (path corners,
   * doorway cells, arrivals, placements). Cleared every tick; the server hands them to browsers so
   * a turn between two updates isn't drawn through a wall (docs/08). The simulation never reads it.
   */
  trail: Map<string, { x: number; y: number }[]>;
  tasks: Map<string, Task>;
  taskSeq: number;
  shiftLog: Map<string, ShiftLog>;
  rnOnCall: boolean;
  agencyCount: number;
  float: FloatState;
  /** The on-call RN coming over from the main building for a serious fall. */
  onCallRn: { status: "off" | "coming" | "on_site" | "leaving"; arriveT: number | null; residentId: string | null };
  /** Medication rounds nobody on the wing could give at their time: given when the on-call RN comes over. */
  pendingRounds: { round: string; roundT: number }[];
  /** A carer from the main building, asked for when every care staff member here is with a fallen resident. */
  mainCarer: { status: "off" | "coming" | "on_site" | "leaving"; arriveT: number | null; retryT: number };
  /** Recent falls, for explaining missed service targets. */
  fallLog: { residentId: string; severity: "minor" | "serious"; t: number; endT: number | null }[];
  /** Last time a carer was in the Lounge (the lounge_supervision service target). */
  loungeSeenT: number;
  /** A group activity running in the Lounge. */
  session: { staffId: string; activity: string; residentIds: string[]; endT: number; roomId: string } | null;
  /** Today's birthdays and festivals (docs/10, sub-milestone d). */
  celebrations: Celebration[];
  /** Ambulance calls in the order they were made; one crew answers them in turn (off the map until due). */
  paramedics: { taskId: string; dueT: number }[];
  metrics: { floatCallouts: number; medInterruptions: number };
  /** Invariant rules currently failing, so violations are logged once when they start. */
  failing: Set<string>;
  inputs: SimInput[];
  /** The scenario director (docs/10); null when it's off. */
  director: DirectorState | null;
  /** Doors and windows (v1.0-testbed); set by `initBuilding`. */
  building: BuildingState | null;
  /** data/director.json: used by the director and by the rules it triggers (cover, infection), also when it's off. */
  config: DirectorConfig | null;
  /** New residents' cards (data/personas/admissions.json); only reviewed ones move in. */
  admissions: AdmissionCard[];
  /** Deaths and end-of-life decline happen (off for the public demo). */
  deaths: boolean;
  /** Symptom onsets by disease (outbreak detection), and outbreaks declared so far. */
  onsets: { personId: string; disease: Disease; t: number; symptomsEndT: number }[];
  outbreaks: Outbreak[];
  /** Sick calls and no-shows (docs/10). */
  absences: Absence[];
  pending: AnySimEvent[];
  seq: number;
}

export const CARE_ROLES = new Set(["senior_carer", "care_assistant", "registered_nurse", "agency_carer", "agency_nurse", "main_building_carer"]);

export function isCareStaff(p: Person): boolean {
  return !!p.staff && CARE_ROLES.has(p.staff.role);
}

export function isNurse(p: Person): boolean {
  return p.staff?.role === "registered_nurse" || p.staff?.role === "agency_nurse";
}

/** On shift (or staying on after it) and able to be given work. */
export function onDuty(p: Person): boolean {
  return p.onMap && (p.staff?.duty === "on_shift" || p.staff?.duty === "staying");
}

/**
 * Where a resident sits out of bed in their room: their bedside chair, or for a hoisted wheelchair
 * user (Raj) their wheelchair spot by the bed. Bed-bound residents (Dennis) have neither.
 */
export function chairFor(resident: Person): string {
  const room = resident.resident!.data.room;
  return resident.resident!.data.care.transfer_method === "hoist" ? `${room}.Wheelchair` : `${room}.Chair`;
}

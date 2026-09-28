// Engine-internal world state. Plain serialisable data (no callbacks), iterated in id order.

import type {
  AnySimEvent,
  Badge,
  Competency,
  Gender,
  NamedPoint,
  NeedName,
  PersonKind,
  Posture,
  Resident,
  ShiftName,
  SimInput,
  StaffRole,
  WorldData,
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
}

export interface StaffState {
  role: StaffRole | "agency_carer" | "agency_nurse";
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
}

export type TaskKind = "assist" | "handover" | "briefing" | "break" | "self_toilet";

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
  tasks: Map<string, Task>;
  taskSeq: number;
  shiftLog: Map<string, ShiftLog>;
  rnOnCall: boolean;
  agencyCount: number;
  /** Invariant rules currently failing, so violations are logged once when they start. */
  failing: Set<string>;
  inputs: SimInput[];
  pending: AnySimEvent[];
  seq: number;
}

export const CARE_ROLES = new Set(["senior_carer", "care_assistant", "registered_nurse", "agency_carer", "agency_nurse"]);

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

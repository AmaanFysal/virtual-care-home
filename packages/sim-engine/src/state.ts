// Engine-internal world state. Plain serialisable data (no callbacks), iterated in id order.

import type {
  AnySimEvent,
  Badge,
  Competency,
  Gender,
  NamedPoint,
  PersonKind,
  Posture,
  ShiftName,
  SimInput,
  StaffRole,
  WorldData,
} from "@vch/shared-types";
import type { Rng, StreamName } from "./rng.js";
import type { Grid } from "./world/grid.js";

export interface Move {
  destPointId: string;
  /** Grid cells to walk through, ending at the destination's cell. */
  cells: number[];
  /** Index into `cells` of the next waypoint. */
  next: number;
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
  duty: "off" | "arriving" | "on_shift" | "leaving";
  shift: ShiftAssignment | null;
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
  /** Named point the person is standing or sitting at, if any. */
  atPoint: string | null;
  /** Doorway zone this person currently occupies. */
  heldZone: string | null;
  /** Doorway zone this person is waiting to enter. */
  waitingAtDoor: string | null;
  staff: StaffState | null;
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
  rnOnCall: boolean;
  agencyCount: number;
  inputs: SimInput[];
  pending: AnySimEvent[];
  seq: number;
}

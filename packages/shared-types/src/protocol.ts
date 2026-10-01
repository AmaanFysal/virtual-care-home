// WebSocket protocol between server and browser. See docs/08-realtime-and-ui.md.
// The browser only draws what arrives here and sends commands back.

import type { FloorPlan, Gender } from "./data.js";
import type { AnySimEvent, FallSeverity, InputPayloads, InputType, NeedName } from "./events.js";
import type { BuildingView, PersonActivity, RoomDetail, Touch } from "./world.js";

export type PersonKind = "resident" | "staff" | "agency" | "visitor" | "external";
/** "dozing": asleep in a Lounge armchair (a nap away from their room). */
export type Posture = "standing" | "walking" | "sitting" | "dozing" | "in_bed" | "on_floor";
/** "alert": on the floor after a fall; "obs": back up, on post-fall observations (docs/05). */
export type Badge = "pill" | "tray" | "cup" | "towel" | "hoist" | "asleep" | "confused" | "break" | "handover" | "phone" | "alert" | "obs";
export type ClockSpeed = 1 | 10 | 60 | 360;
/**
 * What a connection may do (docs/08). Viewers watch and inspect; admins also run the clock and
 * trigger events. Locally (dev) every connection is an admin; on the public server everyone is a
 * viewer until they send the admin token.
 */
export type Role = "viewer" | "admin";

/** What the canvas needs to draw one person. */
export interface PersonView {
  id: string;
  kind: PersonKind;
  name: string;
  initials: string;
  onMap: boolean;
  x: number;
  y: number;
  roomId: string | null;
  posture: Posture;
  badges: Badge[];
  /** Short label of the current task, for the inspector and tooltips. */
  task: string | null;
  /** For display only (choosing a sprite): gender, and the staff role for staff, agency and responders. */
  gender: Gender;
  role?: string;
  /**
   * Deltas only: the turning points this person passed since the previous update, in order (path
   * corners, doorway cells, arrivals, and where they were placed or appeared). The browser slides
   * through them before sliding to x, y, so a move that turns a corner between two updates isn't
   * drawn cutting through a wall. Display only.
   */
  via?: { x: number; y: number }[];
  /** An infection (docs/10), while it matters: incubating, symptomatic, or recovering but still isolated or off work. */
  infection?: { disease: "norovirus" | "flu"; status: "incubating" | "symptomatic" | "recovering"; isolated: boolean };
  /** Residents: their bed point, and where they are if off the wing. */
  bedId?: string;
  away?: "hospital" | "died" | null;
}

export interface ClockView {
  t: number;
  tick: number;
  paused: boolean;
  speed: ClockSpeed;
}

/** Extra detail for the inspector panel (sent on request). */
export interface PersonDetail {
  person: PersonView;
  /** Persona card as stored in data/personas. */
  persona: unknown;
  needs: Partial<Record<NeedName, number>> | null;
  workload: number | null;
  currentTask: string | null;
  btNode: string | null;
  schedule: { t: number; label: string }[];
  /** What they're doing now, from the world description (v1.0-testbed); null when off the map. */
  activity: PersonActivity | null;
  /** Their last 20 touches, newest first (v1.0-testbed). */
  touches: Touch[];
}

/** How this run uses the scenario director (docs/10), for the Director panel. */
export interface DirectorView {
  mode: "off" | "random" | "scenario" | "both";
  scenario: { id: string; name: string; description: string } | null;
  deaths: boolean;
  /** Reviewed admission cards that can move in (id and name). */
  admissions?: { id: string; name: string }[];
}

export type ServerMessage =
  | { type: "snapshot"; clock: ClockView; floorplan: FloorPlan; people: PersonView[]; events: AnySimEvent[]; director: DirectorView; building: BuildingView; role: Role }
  /** `building`: only the doors, windows and equipment that changed, and the weather when its hour changed. */
  | { type: "delta"; clock: ClockView; people: PersonView[]; events: AnySimEvent[]; building?: Partial<BuildingView> }
  | { type: "clock"; clock: ClockView }
  | { type: "detail"; detail: PersonDetail }
  | { type: "room"; room: RoomDetail }
  /** The answer to `auth`: the connection's role from now on. */
  | { type: "auth"; ok: boolean; role: Role; message?: string }
  | { type: "error"; message: string };

export type ClientCommand =
  /** Unlocks admin controls on the public server with the secret token (never stored by the server). */
  | { type: "auth"; token: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "step" }
  | { type: "set_speed"; speed: ClockSpeed }
  | { type: "inspect"; personId: string }
  /** A room's slice of the world description, for the inspector (v1.0-testbed). */
  | { type: "inspect_room"; roomId: string }
  | { type: "inject_fall"; residentId: string; severity: FallSeverity }
  /** Any director event, triggered by hand from the Director panel (applied with source "user"). */
  | { type: "inject"; input: InputType; params: InputPayloads[InputType] };

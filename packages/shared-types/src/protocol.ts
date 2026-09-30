// WebSocket protocol between server and browser. See docs/08-realtime-and-ui.md.
// The browser only draws what arrives here and sends commands back.

import type { FloorPlan, Gender } from "./data.js";
import type { AnySimEvent, FallSeverity, InputPayloads, InputType, NeedName } from "./events.js";

export type PersonKind = "resident" | "staff" | "agency" | "visitor" | "external";
/** "dozing": asleep in a Lounge armchair (a nap away from their room). */
export type Posture = "standing" | "walking" | "sitting" | "dozing" | "in_bed" | "on_floor";
/** "alert": on the floor after a fall; "obs": back up, on post-fall observations (docs/05). */
export type Badge = "pill" | "tray" | "cup" | "towel" | "hoist" | "asleep" | "confused" | "break" | "handover" | "phone" | "alert" | "obs";
export type ClockSpeed = 1 | 10 | 60 | 360;

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
  /** Residents: their bed point, and where they are if off the wing. */
  bedId?: string;
  away?: "hospital" | null;
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
}

/** How this run uses the scenario director (docs/10), for the Director panel. */
export interface DirectorView {
  mode: "off" | "random" | "scenario" | "both";
  scenario: { id: string; name: string; description: string } | null;
  deaths: boolean;
}

export type ServerMessage =
  | { type: "snapshot"; clock: ClockView; floorplan: FloorPlan; people: PersonView[]; events: AnySimEvent[]; director: DirectorView }
  | { type: "delta"; clock: ClockView; people: PersonView[]; events: AnySimEvent[] }
  | { type: "clock"; clock: ClockView }
  | { type: "detail"; detail: PersonDetail }
  | { type: "error"; message: string };

export type ClientCommand =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "step" }
  | { type: "set_speed"; speed: ClockSpeed }
  | { type: "inspect"; personId: string }
  | { type: "inject_fall"; residentId: string; severity: FallSeverity }
  /** Any director event, triggered by hand from the Director panel (applied with source "user"). */
  | { type: "inject"; input: InputType; params: InputPayloads[InputType] };

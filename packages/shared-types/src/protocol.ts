// WebSocket protocol between server and browser. See docs/08-realtime-and-ui.md.
// The browser only draws what arrives here and sends commands back.

import type { FloorPlan } from "./data.js";
import type { AnySimEvent, FallSeverity, NeedName } from "./events.js";

export type PersonKind = "resident" | "staff" | "agency" | "visitor" | "external";
/** "dozing": asleep in a Lounge armchair (a nap away from their room). */
export type Posture = "standing" | "walking" | "sitting" | "dozing" | "in_bed" | "on_floor";
export type Badge = "pill" | "tray" | "cup" | "towel" | "hoist" | "asleep" | "confused" | "break" | "handover" | "phone" | "alert";
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

export type ServerMessage =
  | { type: "snapshot"; clock: ClockView; floorplan: FloorPlan; people: PersonView[]; events: AnySimEvent[] }
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
  | { type: "inject_fall"; residentId: string; severity: FallSeverity };

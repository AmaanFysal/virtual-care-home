// The world description (v1.0-testbed, docs/workstreams/v1-testbed/spec.md): what external
// models (air, heat, surfaces, energy) read every step. The engine describes; it models no
// physics (constitution rule 4, ADR-0006). A contract: any change bumps `schema`.

import type { EquipmentKind, WeatherHour } from "./data.js";

export const WORLD_SCHEMA = 1;

/** What a resident can be doing (MET from data/activities.json, mostly the 2024 Older Adult Compendium). */
export const RESIDENT_ACTIVITIES = [
  "sleeping",
  "lying",
  "on_floor",
  "sitting",
  "standing",
  "watching_tv",
  "reading",
  "puzzles",
  "chatting",
  "eating",
  "toileting",
  "walking",
  "in_wheelchair",
  "receiving_care",
  "being_hoisted",
] as const;

/** What staff, visitors and responders can be doing (MET from the 2024 Adult Compendium). */
export const OTHER_ACTIVITIES = [
  "walking",
  "pushing_wheelchair",
  "standing",
  "sitting",
  "talking",
  "desk_work",
  "tidying",
  "personal_care",
  "hoisting",
  "assisting_meal",
  "serving",
  "checking",
  "med_round",
  "leading_activity",
  "on_break",
  "handover",
  "fall_response",
  "visiting",
] as const;

export type ResidentActivity = (typeof RESIDENT_ACTIVITIES)[number];
export type OtherActivity = (typeof OTHER_ACTIVITIES)[number];
export type Activity = ResidentActivity | OtherActivity;

/** The Compendium's bands: sedentary up to 1.5 MET, light to 2.9, moderate to 5.9, vigorous from 6. */
export type Intensity = "sedentary" | "light" | "moderate" | "vigorous";

export interface PersonActivity {
  personId: string;
  kind: "resident" | "staff" | "agency" | "visitor" | "external";
  roomId: string | null;
  x: number;
  y: number;
  activity: Activity;
  /** Metabolic equivalent, from the Compendium entry `code` in `book`. */
  met: number;
  intensity: Intensity;
  book: "older" | "adult";
  code: string;
}

/** A door's state. A closed or locked door someone is passing through is shown "open", `heldBy` them. */
export interface DoorState {
  doorId: string;
  rooms: [string, string];
  state: "open" | "ajar" | "closed" | "locked";
  heldBy: string | null;
}

export interface WindowState {
  windowId: string;
  roomId: string;
  state: "open" | "closed";
  /** How far it's open: the restrictor's limit when open (data/building.json), 0 when closed. */
  openingMm: number;
}

export interface EquipmentState {
  equipmentId: string;
  kind: EquipmentKind;
  roomId: string;
  on: boolean;
  /** Lights: dim (a night check, the corridor's night lights) or full. */
  level?: "dim" | "full";
  /** Heating: the set point (°C); whether the radiator gives out heat is the heat model's to say. */
  setpointC?: number;
}

/** Someone's hand on an object (v1.0-testbed). Objects: furniture, door handles and the exit keypad, light switches, windows, equipment, and a resident's own things (`res_x.cup`). */
export interface Touch {
  personId: string;
  objectId: string;
  t: number;
}

/** The outdoor weather this hour: one row of the data file, with the data's own timestamp (GMT). */
export type Weather = WeatherHour;

export interface WorldDescription {
  schema: typeof WORLD_SCHEMA;
  t: number;
  tick: number;
  /** Everyone on the map, in id order. */
  people: PersonActivity[];
  doors: DoorState[];
  windows: WindowState[];
  equipment: EquipmentState[];
  /** Touches on objects in this tick (since the previous description, when described every tick). */
  touches: Touch[];
  /** Null when the run has no weather data. */
  weather: Weather | null;
}

/** The building part of the description, as the browser gets it (snapshot, and changes in deltas). */
export interface BuildingView {
  doors: DoorState[];
  windows: WindowState[];
  equipment: EquipmentState[];
  weather: Weather | null;
}

/** A room's slice of the world description, for the inspector. */
export interface RoomDetail {
  roomId: string;
  name: string;
  kind: string;
  areaM2: number;
  ceilingM: number;
  t: number;
  doors: DoorState[];
  windows: WindowState[];
  equipment: EquipmentState[];
  people: (PersonActivity & { name: string })[];
  /** The last 20 touches in the room (an en-suite's count for its bedroom), newest first. */
  touches: Touch[];
  weather: Weather | null;
}

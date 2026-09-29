// Which LPC character sheet draws each person, from data/sprites.json (written by
// tools/characters/import.mjs). Display only: nothing here affects the simulation.

import type { PersonView } from "@vch/shared-types";
import manifest from "../../../data/sprites.json";

export type Pose = "walk" | "stand" | "sit" | "bed" | "floor";

export interface SpriteEntry {
  name: string;
  group: string;
  sheet: string;
  poses: Pose[];
  /** "wheelchair": sit using the wheelchair block (Raj). */
  sit?: "wheelchair";
  overlay?: "zimmer";
  scale?: number;
}

export const sprites = manifest as unknown as {
  frame: number;
  columns: number;
  directions: ("north" | "west" | "south" | "east")[];
  layout: Record<string, { row?: number; frame?: number; frames?: number; cycle?: number[]; y?: number; head?: { x: number; y: number; w: number; h: number } }>;
  overlays: Record<string, { image: string; poses: Pose[]; frames: Record<string, { index: number; under?: boolean }> }>;
  roles: Record<string, Record<"female" | "male", string>>;
  people: Record<string, SpriteEntry>;
};

/**
 * The sprite id for a person: their own sheet if they have one (residents, staff, visitors, the
 * floating night carer, the on-call nurse), otherwise one chosen by staff role and gender (agency
 * staff, whose ids are made up when they're booked, and the paramedics).
 */
export function spriteIdFor(view: Pick<PersonView, "id" | "gender" | "role">): string | null {
  if (sprites.people[view.id]) return view.id;
  const byRole = view.role ? sprites.roles[view.role] : undefined;
  return byRole ? byRole[view.gender] : null;
}

export function spriteFor(view: Pick<PersonView, "id" | "gender" | "role">): SpriteEntry | null {
  const id = spriteIdFor(view);
  return id ? sprites.people[id]! : null;
}

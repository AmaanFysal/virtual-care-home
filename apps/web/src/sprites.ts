// Which LPC character sheet draws each person, from data/sprites.json (written by
// tools/characters/import.mjs). Display only: nothing here affects the simulation.

import { spriteIdFor as sharedSpriteIdFor, type PersonView } from "@vch/shared-types";
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

/** The sprite id for a person (shared with the audit's clash check, docs/08). */
export function spriteIdFor(view: Pick<PersonView, "id" | "gender" | "role"> & { kind?: PersonView["kind"] }): string | null {
  return sharedSpriteIdFor(sprites, view);
}

export function spriteFor(view: Pick<PersonView, "id" | "gender" | "role"> & { kind?: PersonView["kind"] }): SpriteEntry | null {
  const id = spriteIdFor(view);
  return id ? sprites.people[id]! : null;
}

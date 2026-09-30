// Which LPC character sheet draws each person (data/sprites.json), shared by the browser, which
// draws them, and the audit, which checks that nobody on screen looks like someone else there.
// Display only: nothing here affects the simulation.

import type { PersonKind } from "./protocol.js";

/** The parts of data/sprites.json that choose a sheet. */
export interface SpriteChoice {
  /** People without a sheet of their own, by staff role (or `resident`) and gender. */
  roles: Record<string, Record<"female" | "male", string>>;
  people: Record<string, unknown>;
}

export interface SpritePerson {
  id: string;
  gender: "female" | "male";
  role?: string;
  kind?: PersonKind;
}

/** Uniforms: several people in the same one on screen is expected (two agency carers, the crew). */
export const UNIFORM_ROLES: readonly string[] = ["agency_carer", "agency_nurse", "paramedic"];

/**
 * The sprite id for a person: their own sheet if they have one (residents, staff, visitors, the
 * floating night carer, the on-call nurse), otherwise one chosen by staff role and gender (agency
 * staff, whose ids are made up when they're booked, and the paramedics), and for a resident who
 * moved in mid-run (docs/10) a stand-in by gender until their own character is generated.
 */
export function spriteIdFor(manifest: SpriteChoice, p: SpritePerson): string | null {
  if (manifest.people[p.id]) return p.id;
  const byRole = p.role ? manifest.roles[p.role] : p.kind === "resident" ? manifest.roles.resident : undefined;
  return byRole ? byRole[p.gender] : null;
}

/**
 * People on screen at once who are drawn with the same sheet, so would look like the same person
 * (a stand-in borrowing a visitor's sheet while that visitor is in). People in a uniform may share
 * it with each other. Each clash is the sheet and the ids drawn with it, sorted.
 */
export function spriteClashes(manifest: SpriteChoice, onScreen: SpritePerson[]): { sheet: string; ids: string[] }[] {
  const bySheet = new Map<string, SpritePerson[]>();
  for (const p of onScreen) {
    const sheet = spriteIdFor(manifest, p);
    if (sheet) bySheet.set(sheet, [...(bySheet.get(sheet) ?? []), p]);
  }
  const out: { sheet: string; ids: string[] }[] = [];
  for (const [sheet, people] of [...bySheet].sort(([a], [b]) => a.localeCompare(b))) {
    if (people.length < 2) continue;
    if (people.every((p) => p.id !== sheet && p.role !== undefined && UNIFORM_ROLES.includes(p.role))) continue;
    out.push({ sheet, ids: people.map((p) => p.id).sort() });
  }
  return out;
}

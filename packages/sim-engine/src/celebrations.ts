// Birthdays and festivals (docs/10, sub-milestone d). A `celebration` input (from the calendar in
// random mode, a scenario or the admin panel) marks today: the family comes (visitors.ts), and
// there's tea and cake in the afternoon (lounge.ts). During an outbreak there's no gathering: it's
// logged, and visits stay essential-only.

import { SECONDS_PER_DAY, clockToSeconds, dayIndex, type InputPayloads, type Source } from "@vch/shared-types";
import { emit } from "./emit.js";
import { outbreakOn } from "./infection.js";
import type { World } from "./state.js";
import { celebrationVisits } from "./visitors.js";

/** Applies `celebration`. */
export function celebrate(world: World, params: InputPayloads["celebration"], source: Source): string | null {
  if (!world.config) return "no celebration settings (data/director.json) for this run";
  const here = params.residentIds.filter((id) => world.people.get(id)?.resident && world.people.get(id)!.onMap);
  if (here.length === 0) return "nobody to celebrate on the wing";
  const day = dayIndex(world.t);
  const cfg = world.config.celebrations;
  const gathering = !outbreakOn(world);
  const at = (clock: string) => day * SECONDS_PER_DAY + clockToSeconds(clock);
  world.celebrations.push({ day, kind: params.kind, name: params.name, residentIds: [...here], gathering, teaFrom: at(cfg.tea[0]), teaUntil: at(cfg.tea[1]), tea: "pending", teaRoom: null, came: { residents: [], visitors: [] } });
  emit(world, "celebration.started", here, { kind: params.kind, name: params.name, residentIds: here, gathering, ...(gathering ? {} : { reason: "outbreak: no gathering, essential visits only" }) }, source);
  if (gathering) celebrationVisits(world, here);
  return null;
}

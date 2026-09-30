// The scenario director in the running world (docs/10). Off unless a run asks for it. At the
// start and at 00:00 it plans the day: random events from the base rates (plan.ts) and the
// scenario's scripted events for that day. Each planned event is logged (`director.planned`) and
// applied at its time through the same dispatch as manual inputs, with source "director".

import { SECONDS_PER_DAY, dayIndex, type DirectorSettings, type InputPayloads, type InputType, type Source } from "@vch/shared-types";
import { emit } from "../emit.js";
import { staffSick, shiftNoShow } from "../cover.js";
import { injectFall } from "../falls.js";
import { infect } from "../infection.js";
import type { DirectorEvent, World } from "../state.js";
import { isMajor, planRandomDay, residentRisk, type RosterEntry } from "./plan.js";
import { scenarioEvents } from "./scenario.js";

export function initDirector(world: World, settings: DirectorSettings): void {
  world.director = {
    settings,
    queue: [],
    script: settings.scenario ? scenarioEvents(settings.scenario, world.startT) : [],
    dayTypes: new Map(),
    majorTs: [],
    quietUntil: 0,
  };
}

/** Plans the day that `fromT` falls in, from `fromT` on. */
export function planDirectorDay(world: World, fromT: number): void {
  const d = world.director;
  if (!d) return;
  const day = dayIndex(fromT);
  let planned: DirectorEvent[] = [];
  let suppressed: { event: DirectorEvent; reason: string }[] = [];
  let dayType: "ordinary" | "busy" | "hard" | "scripted" = "scripted";
  let downgradedFrom = null;

  if (d.settings.random) {
    const staffCards = new Map(world.data.staff.map((s) => [s.id, s]));
    const roster: RosterEntry[] = world.shifts
      .filter((a) => dayIndex(a.startT) === day && !a.spawned && !a.stayOn)
      .map((a) => ({
        personId: a.personId,
        slot: a.slot,
        shift: a.shift,
        startT: a.startT,
        endT: a.endT,
        agency: world.people.get(a.personId)?.kind === "agency",
        propensity: staffCards.get(a.personId)?.contract.sickness_propensity ?? 0,
      }));
    const residents = world.order
      .map((id) => world.people.get(id)!)
      .filter((p) => p.resident && p.onMap)
      .map((p) => residentRisk(p.resident!.data));
    const plan = planRandomDay(d.settings.config, world.rng.director, d, day, fromT, roster, residents);
    ({ planned, suppressed, dayType, downgradedFrom } = plan);
  }

  // Scripted events are applied exactly as written: no caps, but they count towards them.
  const scripted = d.script.filter((e) => dayIndex(e.applyT) === day);
  d.script = d.script.filter((e) => dayIndex(e.applyT) !== day);
  for (const e of scripted) if (isMajor(e)) d.majorTs.push(e.applyT);
  planned = [...scripted, ...planned].sort((a, b) => a.applyT - b.applyT);
  d.majorTs = d.majorTs.filter((t) => t > fromT - 7 * SECONDS_PER_DAY);

  d.dayTypes.set(day, dayType);
  emit(world, "director.day_planned", [], { day, dayType, planned: planned.length, suppressed: suppressed.length, ...(downgradedFrom ? { downgradedFrom } : {}) }, "director");
  for (const e of planned) emit(world, "director.planned", [], { inputType: e.type, applyT: e.applyT, origin: e.origin, reason: reasonFor(e), params: e.params }, "director");
  for (const { event, reason } of suppressed) emit(world, "director.suppressed", [], { inputType: event.type, applyT: event.applyT, reason, params: event.params }, "director");
  d.queue = [...d.queue, ...planned].sort((a, b) => a.applyT - b.applyT);
}

function reasonFor(e: DirectorEvent): string {
  if (e.origin !== "random") return "scripted";
  if (e.type === "inject_fall") return "falls base rate";
  if (e.type === "staff_sick") return "sickness base rate";
  if (e.type === "shift_no_show") return "agency no-show rate";
  return "base rate";
}

/** Applies the director's events that are due (after any manual inputs this tick). */
export function applyDirectorEvents(world: World): void {
  const d = world.director;
  if (!d) return;
  while (d.queue.length > 0 && d.queue[0]!.applyT <= world.t) {
    const e = d.queue.shift()!;
    applyInput(world, e.type, e.params, "director");
  }
}

/** The one dispatch for every input, manual or planned; one that can't apply is logged as `input.skipped`. */
export function applyInput<K extends InputType>(world: World, type: K, params: InputPayloads[K], source: Source): void {
  const skipped = dispatch(world, type, params, source);
  if (skipped) emit(world, "input.skipped", [], { inputType: type, reason: skipped, params }, source);
}

function dispatch<K extends InputType>(world: World, type: K, params: InputPayloads[K], source: Source): string | null {
  if (type === "inject_fall") {
    const { residentId, severity } = params as InputPayloads["inject_fall"];
    const r = world.people.get(residentId);
    if (!r?.resident) return "unknown resident";
    if (!r.onMap) return "not on the wing";
    if (r.resident.fall) return "already on the floor";
    injectFall(world, residentId, severity, source);
    return null;
  }
  if (type === "staff_sick") {
    const { staffId, cover } = params as InputPayloads["staff_sick"];
    return staffSick(world, staffId, cover ?? "auto", source);
  }
  if (type === "infection_case") {
    const { personId, disease } = params as InputPayloads["infection_case"];
    const p = world.people.get(personId);
    if (!world.config) return "no infection settings (data/director.json) for this run";
    if (!p || !(p.resident || p.kind === "staff")) return "not a resident or member of staff";
    if (p.infection) return "has already had an infection this run";
    if (p.resident && !p.onMap) return "not on the wing";
    infect(world, p, disease, "introduced", null, source);
    return null;
  }
  if (type === "shift_no_show") {
    const { slot, cover } = params as InputPayloads["shift_no_show"];
    return shiftNoShow(world, slot, cover ?? "auto", source);
  }
  return `unknown input type ${String(type)}`;
}

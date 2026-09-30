// The scenario director in the running world (docs/10). Off unless a run asks for it. At the
// start and at 00:00 it plans the day: random events from the base rates (plan.ts) and the
// scenario's scripted events for that day. Each planned event is logged (`director.planned`) and
// applied at its time through the same dispatch as manual inputs, with source "director".

import { SECONDS_PER_DAY, dayIndex, type DirectorSettings, type InputPayloads, type InputType, type Source } from "@vch/shared-types";
import { emit } from "../emit.js";
import { staffSick, shiftNoShow } from "../cover.js";
import { injectFall } from "../falls.js";
import { infect } from "../infection.js";
import { admit, startEndOfLife, startIllness } from "../health.js";
import { celebrate } from "../celebrations.js";
import { weekOff } from "../visitors.js";
import { celebrationsOn } from "./calendar.js";
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
    const dayStart = day * SECONDS_PER_DAY;
    const residents = world.order
      .map((id) => world.people.get(id)!)
      .filter((p) => p.resident && p.onMap)
      .map((p) => {
        const res = p.resident!;
        // Falls likelier while ill and for two weeks after a hospital stay (docs/10).
        const h = d.settings.config.health;
        const extra = (res.illness ? h.illness.falls_factor : 1) * (res.recentReturnUntil > dayStart ? h.after_return.falls_factor : 1);
        return { ...residentRisk(res.data), extra, busy: !!res.illness || !!res.endOfLife };
      });
    const endOfLifeOn = world.order.some((id) => !!world.people.get(id)!.resident?.endOfLife);
    // Lead visitors of residents on the wing, for their missed weeks (sub-milestone d).
    const visitors = world.order
      .map((id) => world.people.get(id)!)
      .filter((p) => p.visitor && !p.visitor.leadId && world.people.get(p.visitor.residentId)!.onMap)
      .map((p) => ({ id: p.id, reliability: p.visitor!.data.visit_pattern.reliability, staying: !!world.people.get(p.visitor!.residentId)!.resident!.endOfLife }));
    const plan = planRandomDay(d.settings.config, world.rng.director, d, day, fromT, roster, residents, { deaths: world.deaths, endOfLifeOn, visitors, visitorRng: world.rng.visitor_weeks });
    ({ planned, suppressed, dayType, downgradedFrom } = plan);
    // Birthdays and festivals from the calendar: not random, the same in every run.
    const onWing = world.order.map((id) => world.people.get(id)!).filter((p) => p.resident && p.onMap);
    const cards = onWing.map((p) => ({ id: p.id, name: p.name, dob: p.resident!.data.dob, faith: p.resident!.data.faith ?? "" }));
    for (const c of celebrationsOn(d.settings.config.celebrations, day, cards)) planned.push({ applyT: fromT + 60, type: "celebration", params: c, origin: "calendar" });
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
  if (e.origin === "calendar") return (e.params as { kind: string }).kind === "birthday" ? "birthday (the card's date of birth)" : "festival (the residents' faith)";
  if (e.origin !== "random") return "scripted";
  if (e.type === "visitor_week_off") return "visitors' missed weeks";
  if (e.type === "inject_fall") return "falls base rate";
  if (e.type === "staff_sick") return "sickness base rate";
  if (e.type === "shift_no_show") return "agency no-show rate";
  if (e.type === "resident_illness") return "illness base rate";
  if (e.type === "end_of_life_start") return "deaths base rate";
  if (e.type === "infection_case") return "infections brought in";
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
  if (type === "resident_illness") {
    const { residentId, kind, severity } = params as InputPayloads["resident_illness"];
    const r = world.people.get(residentId);
    return r ? startIllness(world, r, kind, severity, source) : "unknown resident";
  }
  if (type === "end_of_life_start") {
    const { residentId, expectedDays } = params as InputPayloads["end_of_life_start"];
    const r = world.people.get(residentId);
    return r ? startEndOfLife(world, r, expectedDays, source) : "unknown resident";
  }
  if (type === "admission") return admit(world, (params as InputPayloads["admission"]).cardId, source);
  if (type === "visitor_week_off") {
    const { visitorId, cause } = params as InputPayloads["visitor_week_off"];
    return weekOff(world, visitorId, cause, source);
  }
  if (type === "celebration") return celebrate(world, params as InputPayloads["celebration"], source);
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

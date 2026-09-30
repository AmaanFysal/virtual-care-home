// Infections and outbreaks (docs/10, sub-milestone b). An infection is introduced from outside
// (`infection_case`), then spreads each minute through separate, pluggable routes, each scaled by
// the disease's weight in data/director.json:
// - contact: a chance per minute within 1.5 m of someone infectious (care, sitting together);
// - airborne (proxy): a chance per hour in the same room as someone infectious. It reads only who
//   is in which room (no air quality, constitution rule 4); the future air model replaces this
//   term in the same slot, so steriliser experiments need that model, not the proxy.
// The routes combine as independent risks, p = 1 - product(1 - p_route), so nothing is counted
// twice. Residents with symptoms are isolated in their room; staff with symptoms go home and stay
// off. Two cases within 48 hours declare an outbreak (the Lounge closes, only essential visits);
// it ends 48 hours after the last case is symptom-free (norovirus) or 5 days after the last onset
// (flu, UKHSA 2024), and never while a case is still ill. With nobody infected none of this runs or draws randomness.

import type { Disease, Source } from "@vch/shared-types";
import { excludeUpcoming, sendHomeSick } from "./cover.js";
import { emit } from "./emit.js";
import type { Person, World } from "./state.js";

const HOUR = 3600;

/** Independent risks combined: the chance at least one of them happens. */
export function combine(chances: number[]): number {
  let none = 1;
  for (const p of chances) none *= 1 - p;
  return 1 - none;
}

/** A resident isolated in their room with an infection. */
export function isIsolated(p: Person): boolean {
  return !!p.resident && !!p.infection?.isolated;
}

/** An outbreak is on: the Lounge is closed and only essential visits go ahead. */
export function outbreakOn(world: World): boolean {
  return world.outbreaks.some((o) => o.overT === null);
}

/** Essential visits during an outbreak: to a resident at the end of their life. */
export function essentialVisit(resident: Person): boolean {
  return resident.resident!.data.conditions.some((c) => /end of life/i.test(c));
}

/** Extra minutes for a care visit to an isolated resident (PPE on and off). */
export function ppeMins(world: World, resident: Person | null): number {
  return resident && isIsolated(resident) ? world.config!.infection.ppe_extra_mins : 0;
}

function infectious(p: Person, t: number): boolean {
  return !!p.infection && p.onMap && t >= p.infection.infectiousFromT && t < p.infection.infectiousUntilT;
}

/** Residents, staff and agency workers can catch it; visitors and people from the main building aren't modelled. */
function susceptible(p: Person): boolean {
  return p.onMap && !p.infection && (!!p.resident || p.kind === "staff" || p.kind === "agency");
}

/**
 * The chance per minute each route gives `target` from one infectious `source`. The `airborne` term
 * is the proxy: the future air model replaces it here and nothing else changes.
 */
export function routeChances(world: World, source: Person, target: Person): { contact: number; airborne: number } {
  const cfg = world.config!.infection;
  const weights = cfg.diseases[source.infection!.disease].routes;
  if (!source.roomId || source.roomId !== target.roomId) return { contact: 0, airborne: 0 };
  const ppe = isIsolated(source) || isIsolated(target);
  const near = Math.hypot(source.x - target.x, source.y - target.y) <= cfg.contact.within_m;
  return {
    contact: near ? cfg.contact.p_per_minute * weights.contact * (ppe ? cfg.ppe.contact : 1) : 0,
    airborne: (cfg.airborne_proxy.p_per_hour_same_room / 60) * weights.airborne * (ppe ? cfg.ppe.airborne : 1),
  };
}

/** Someone catches it: their course (incubation, symptoms, infectious period) is drawn now. */
export function infect(world: World, p: Person, disease: Disease, route: "contact" | "airborne (proxy)" | "introduced", sourceId: string | null, source: Source): void {
  const d = world.config!.infection.diseases[disease];
  const rng = world.rng.infection;
  const hours = ([lo, hi]: [number, number]) => rng.int(lo * 60, hi * 60) * 60;
  const t = world.t;
  // Brought in from outside: they're ill now. Caught here: after the incubation period.
  const symptomaticFromT = route === "introduced" ? t : t + hours(d.incubation_hours);
  const symptomsEndT = symptomaticFromT + hours(d.symptomatic_hours);
  const after = p.resident ? d.isolation_after_symptoms_hours : d.staff_exclusion_after_symptoms_hours;
  p.infection = {
    disease,
    exposedT: t,
    route,
    infectiousFromT: Math.max(t, symptomaticFromT - d.infectious_before_symptoms_hours * HOUR),
    symptomaticFromT,
    symptomsEndT,
    infectiousUntilT: symptomsEndT + d.infectious_after_symptoms_hours * HOUR,
    isolatedUntilT: symptomsEndT + after * HOUR,
    symptomatic: false,
    recovered: false,
    isolated: false,
  };
  emit(world, "infection.exposed", [p.id, ...(sourceId ? [sourceId] : [])], { personId: p.id, disease, route, sourceId, roomId: p.roomId }, source);
  if (route === "introduced") onset(world, p);
}

/** Symptoms start: a resident is isolated in their room; staff go home and stay off. The outbreak count goes up. */
function onset(world: World, p: Person): void {
  const inf = p.infection!;
  const cfg = world.config!.infection;
  inf.symptomatic = true;
  inf.isolated = true;
  emit(world, "infection.symptomatic", [p.id], { personId: p.id, disease: inf.disease, roomId: p.roomId });
  if (p.resident) emit(world, "infection.isolated", [p.id], { personId: p.id, disease: inf.disease, roomId: p.resident.data.room.split(".")[0]! });
  else sendHomeSick(world, p);

  world.onsets.push({ personId: p.id, disease: inf.disease, t: world.t });
  const on = world.outbreaks.find((o) => o.disease === inf.disease && o.overT === null);
  if (on) {
    on.cases.push(p.id);
    on.lastCaseT = world.t;
    return;
  }
  const recent = world.onsets.filter((o) => o.disease === inf.disease && world.t - o.t <= cfg.outbreak.within_hours * HOUR);
  if (recent.length >= cfg.outbreak.cases) {
    const cases = recent.map((o) => o.personId);
    world.outbreaks.push({ disease: inf.disease, declaredT: world.t, lastCaseT: world.t, cases, overT: null });
    if (world.director) world.director.quietUntil = Number.MAX_SAFE_INTEGER;
    emit(world, "outbreak.declared", cases, { disease: inf.disease, cases });
  }
}

/** Once a minute: courses move on, the routes spread it, staff with it stay off, outbreaks end. */
export function infectionMinute(world: World): void {
  const infected = world.order.map((id) => world.people.get(id)!).filter((p) => p.infection);
  if (infected.length === 0) return;
  const t = world.t;

  for (const p of infected) {
    const inf = p.infection!;
    if (!inf.symptomatic && t >= inf.symptomaticFromT) onset(world, p);
    if (inf.symptomatic && !inf.recovered && t >= inf.symptomsEndT) {
      inf.recovered = true;
      emit(world, "infection.recovered", [p.id], { personId: p.id, disease: inf.disease });
    }
    if (inf.isolated && t >= inf.isolatedUntilT) {
      inf.isolated = false;
      if (p.resident) emit(world, "infection.isolation_ended", [p.id], { personId: p.id, disease: inf.disease });
    }
    // Staff off sick miss every shift that starts before they're clear.
    if (!p.resident && inf.isolated) excludeUpcoming(world, p.id, inf.isolatedUntilT);
  }

  // Spread: each susceptible person, against everyone infectious, over every route.
  const sources = infected.filter((p) => infectious(p, t));
  if (sources.length > 0) {
    for (const id of world.order) {
      const target = world.people.get(id)!;
      if (!susceptible(target)) continue;
      const chances: number[] = [];
      let best: { chance: number; source: Person; route: "contact" | "airborne (proxy)" } | null = null;
      for (const source of sources) {
        const r = routeChances(world, source, target);
        chances.push(r.contact, r.airborne);
        if (r.contact > (best?.chance ?? 0)) best = { chance: r.contact, source, route: "contact" };
        if (r.airborne > (best?.chance ?? 0)) best = { chance: r.airborne, source, route: "airborne (proxy)" };
      }
      if (!best) continue;
      if (world.rng.infection.chance(combine(chances))) infect(world, target, best.source.infection!.disease, best.route, best.source.id, "engine");
    }
  }

  // An outbreak ends as UK practice has it (norovirus: 48 hours after the last case is symptom-free;
  // flu: 5 days after the last onset, UKHSA 2024), never while any case is still ill. No new one
  // is introduced for 14 days after.
  const cfg = world.config!.infection.outbreak;
  for (const o of world.outbreaks) {
    if (o.overT !== null) continue;
    const cases = o.cases.map((id) => world.people.get(id)?.infection).filter((inf) => inf?.disease === o.disease);
    if (cases.some((inf) => !inf!.recovered)) continue;
    const rule = cfg.end[o.disease];
    const from = rule.after === "onset" ? o.lastCaseT : Math.max(...cases.map((inf) => inf!.symptomsEndT));
    if (t - from < rule.hours * HOUR) continue;
    o.overT = t;
    emit(world, "outbreak.over", o.cases, { disease: o.disease, cases: o.cases, days: Math.round(((t - o.declaredT) / 86400) * 10) / 10 });
    if (world.director && !outbreakOn(world)) world.director.quietUntil = t + (world.director.settings.config.pacing.outbreak_quiet_days * 86400);
  }
}

/** The state every infected person is in, for the air model and the inspector. */
export function infectionStatus(p: Person, t: number): "incubating" | "symptomatic" | "recovering" | null {
  const inf = p.infection;
  if (!inf) return null;
  if (!inf.symptomatic) return "incubating";
  if (!inf.recovered) return "symptomatic";
  return t < Math.max(inf.infectiousUntilT, inf.isolatedUntilT) ? "recovering" : null;
}

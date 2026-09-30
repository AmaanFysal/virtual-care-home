// Residents' needs, sleep and self-care (docs/04 "Needs"). Runs once per sim minute.
// Needs run 0 (fine) to 1 (urgent). A resident who can deal with a need alone does so;
// otherwise they ask for help if they can (docs/05 decision 10).

import { clockToSeconds, timeOfDay, type NeedName, type Resident } from "@vch/shared-types";
import { emit } from "./emit.js";
import type { Rng } from "./rng.js";
import type { Person, World } from "./state.js";
import { createAssist, createSelfToilet } from "./tasks.js";

export const NEEDS: NeedName[] = ["hunger", "thirst", "toileting", "fatigue", "social"];

/** Hours for a need to go from 0 to 1, awake and asleep. Fatigue falls while asleep. */
const HOURS_TO_FULL: Record<NeedName, { awake: number; asleep: number }> = {
  hunger: { awake: 6, asleep: 40 },
  thirst: { awake: 4, asleep: 16 },
  toileting: { awake: 3, asleep: 6 },
  fatigue: { awake: 15, asleep: -7 },
  social: { awake: 6, asleep: Infinity },
};

/** A need at or above this is acted on (people wait for meals, and ask for company less readily). */
export const ACT_THRESHOLD: Record<NeedName, number> = { hunger: 0.85, thirst: 0.75, toileting: 0.75, fatigue: 2, social: 0.85 };
/** Toileting this urgent wakes a sleeping resident. */
const WAKE_FOR_TOILET = 0.9;
const NAP_MINUTES = 45;
/** Bed-bound residents with no routine doze through the night. */
const DEFAULT_SLEEP = { bed: "22:00", wake: "07:00" };
/** A drink left by the bed goes stale after this long and is never drunk (docs/05 "Drinks"). */
export const DRINK_STALE_MINS = 120;
/** "Their day" starts (for tea on waking) once they're awake past their wake time, before noon. */
const DAY_FROM = clockToSeconds("04:00");
const DAY_UNTIL = clockToSeconds("12:00");

/** End-of-life comfort feeding only (Dennis): no appetite, so no hunger need; mouth care instead. */
export function noAppetite(r: Resident): boolean {
  return r.care.eating_support === "mouth_care_only";
}

/** Needs someone to help them drink (Raj, Dennis): a drink is never just left with them. */
export function needsHelpToDrink(r: Resident): boolean {
  return r.care.eating_support === "assisted" || r.care.eating_support === "mouth_care_only";
}

export function initialNeeds(rng: Rng): Record<NeedName, number> {
  const around = (v: number) => Math.round((v + (rng.next() - 0.5) * 0.2) * 1000) / 1000;
  return { hunger: around(0.45), thirst: around(0.35), toileting: around(0.35), fatigue: around(0.15), social: around(0.2) };
}

function inWindow(tod: number, start: number, end: number): boolean {
  return start <= end ? tod >= start && tod < end : tod >= start || tod < end;
}

/** Within the resident's night sleep or afternoon nap window. */
export function sleepTime(r: Resident, t: number): boolean {
  const tod = timeOfDay(t);
  const bed = clockToSeconds(r.routine.bed ?? DEFAULT_SLEEP.bed);
  const wake = clockToSeconds(r.routine.wake ?? DEFAULT_SLEEP.wake);
  if (inWindow(tod, bed, wake)) return true;
  if (r.routine.nap) {
    const nap = clockToSeconds(r.routine.nap);
    return inWindow(tod, nap, nap + NAP_MINUTES * 60);
  }
  return false;
}

function hoursToFull(need: NeedName, asleep: boolean): number {
  return asleep ? HOURS_TO_FULL[need].asleep : HOURS_TO_FULL[need].awake;
}

function setBadge(p: Person, badge: "asleep", on: boolean): void {
  const has = p.badges.includes(badge);
  if (on && !has) p.badges.push(badge);
  if (!on && has) p.badges = p.badges.filter((b) => b !== badge);
}

function updateSleep(world: World, p: Person): void {
  const res = p.resident!;
  if (res.fall) return; // on the floor: nothing changes until they've been assessed and moved
  const needsSettled = NEEDS.every((n) => res.needs[n] < ACT_THRESHOLD[n]);
  if (res.asleep) {
    const reason = res.needs.toileting >= WAKE_FOR_TOILET ? "toilet" : !sleepTime(res.data, world.t) ? "routine" : null;
    if (reason) {
      res.asleep = false;
      if (p.posture === "dozing") p.posture = "sitting";
      emit(world, "resident.woke", [p.id], { residentId: p.id, reason });
    }
  } else if (sleepTime(res.data, world.t) && needsSettled && (res.inBed || p.posture === "sitting") && !res.busyTaskId && !p.move) {
    res.asleep = true;
    // A nap in the Lounge is a doze in the armchair; in their room they nap in bed or their chair as before.
    const where = res.inBed ? "bed" : p.roomId === "Lounge" ? "lounge" : "chair";
    if (where === "lounge") p.posture = "dozing";
    emit(world, "resident.fell_asleep", [p.id], { residentId: p.id, where });
  }
  setBadge(p, "asleep", res.asleep);
}

function decay(p: Person): void {
  const res = p.resident!;
  for (const need of NEEDS) {
    const hours = hoursToFull(need, res.asleep);
    res.needs[need] = Math.min(1, Math.max(0, res.needs[need] + 1 / (hours * 60)));
  }
  if (noAppetite(res.data)) res.needs.hunger = 0;
}

/**
 * A drink left by the bed or chair is drunk once the resident is awake and free, if it's still
 * fresh. After DRINK_STALE_MINS it's stale: never drunk, and replaced at the next contact.
 */
function drinkWhatWasLeft(world: World, p: Person): void {
  const res = p.resident!;
  if (res.drinkLeftT === null) return;
  if (world.t - res.drinkLeftT >= DRINK_STALE_MINS * 60) {
    res.drinkLeftT = null;
    res.drinkStale = true;
    return;
  }
  if (res.asleep || res.busyTaskId || res.fall) return;
  res.drinkLeftT = null;
  res.needs.thirst = Math.max(0, res.needs.thirst - 0.7);
  res.needs.hunger = Math.max(0, res.needs.hunger - 0.2);
  res.fluidsMlToday += 200;
}

function canSelfToilet(p: Person): boolean {
  return p.resident!.data.care.toileting === "independent" && p.speed > 0;
}

/** Acts on the most pressing need, if any is over its threshold. */
function act(world: World, p: Person): void {
  const res = p.resident!;
  if (res.busyTaskId || res.requestId || res.fall) return;
  const pressing = NEEDS.filter((n) => res.needs[n] >= ACT_THRESHOLD[n] && (!res.asleep || n === "toileting")).sort(
    (a, b) => res.needs[b] - res.needs[a] || a.localeCompare(b),
  );
  const need = pressing[0];
  if (!need) return;
  if (need === "toileting" && canSelfToilet(p)) {
    createSelfToilet(world, p);
    return;
  }
  if (!res.data.care.can_request_help) return;
  createAssist(world, p, need);
}

export function residentsMinute(world: World): void {
  if (timeOfDay(world.t) === clockToSeconds("07:00")) {
    for (const id of world.order) {
      const res = world.people.get(id)!.resident;
      if (res) res.fluidsMlToday = 0;
    }
  }
  for (const id of world.order) {
    const p = world.people.get(id)!;
    if (!p.resident || !p.onMap) continue;
    decay(p);
    updateSleep(world, p);
    // Their day starts when they're first awake past their wake time (tea on waking, care.ts).
    const r = p.resident;
    const tod = timeOfDay(world.t);
    if (r.wokeT === null && !r.asleep && !sleepTime(r.data, world.t) && tod >= DAY_FROM && tod < DAY_UNTIL) r.wokeT = world.t;
    drinkWhatWasLeft(world, p);
    act(world, p);
  }
}

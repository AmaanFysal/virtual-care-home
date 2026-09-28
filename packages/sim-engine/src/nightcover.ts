// Night-time cover rules (spec decision 16 and the wait-time rule, docs/05).
// Night on the wing is 21:30 to 07:00: after the late shift leaves and before the early shift.

import { SECONDS_PER_DAY, clockToSeconds, timeOfDay } from "@vch/shared-types";
import type { ResidentState, Task, World } from "./state.js";
import { isCareStaff, onDuty } from "./state.js";

const NIGHT_FROM = clockToSeconds("21:30");
const NIGHT_TO = clockToSeconds("07:00");
/** Day requests: help must start within this many minutes. */
export const DAY_WAIT_MINS = 30;
/** A night request needing the floating carer waits for her round only if it is this close. */
const ROUND_WAIT_MINS = 30;
/** Time allowed after the floating carer arrives to start on a waiting request. */
const ARRIVAL_ALLOWANCE_MINS = 20;

export function isNight(t: number): boolean {
  const tod = timeOfDay(t);
  return tod >= NIGHT_FROM || tod < NIGHT_TO;
}

/** Minutes allowed between checks: the day or night interval in force at the last check. */
export function checkInterval(res: ResidentState): number {
  return isNight(res.lastCheckedT) ? res.data.care.check_interval_mins.night : res.data.care.check_interval_mins.day;
}

/** Start of the next floating-carer round strictly after `t`. */
export function nextRoundT(world: World, t: number): number {
  const day = Math.floor(t / SECONDS_PER_DAY);
  const times = world.data.rota.night_float.rounds.map(clockToSeconds);
  let best = Infinity;
  for (const d of [day, day + 1]) {
    for (const tod of times) {
      const at = d * SECONDS_PER_DAY + tod;
      if (at > t && isNight(at) && at < best) best = at;
    }
  }
  return best;
}

/** When a second pair of hands (or a woman) next arrives without a call-out: a round, or the day shift. */
export function nextCoverT(world: World, t: number): number {
  const day = Math.floor(t / SECONDS_PER_DAY);
  const dayStart = (timeOfDay(t) < NIGHT_TO ? day : day + 1) * SECONDS_PER_DAY + NIGHT_TO;
  return Math.min(nextRoundT(world, t), dayStart);
}

/** Whether the staff on duty (not counting the floating carer) can do this task without her. */
export function coverableOnSite(world: World, task: Task): boolean {
  const staff = world.order
    .map((id) => world.people.get(id)!)
    .filter((p) => isCareStaff(p) && onDuty(p) && p.id !== world.data.rota.night_float.id && (!task.femaleOnly || p.gender === "female"));
  return staff.length >= task.staffNeeded;
}

/** The latest time help may start on a new request (the wait-time rule). */
export function requestDeadline(world: World, task: Task): number {
  const t = task.createdT;
  if (!isNight(t) || coverableOnSite(world, task)) return t + DAY_WAIT_MINS * 60;
  const cover = nextCoverT(world, t);
  if (cover - t <= ROUND_WAIT_MINS * 60) return cover + ARRIVAL_ALLOWANCE_MINS * 60;
  return t + DAY_WAIT_MINS * 60; // urgent: a call-out brings her in about 10 minutes
}

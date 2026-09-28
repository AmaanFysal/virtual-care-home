// The floating night carer (spec decision 16): a female carer from the main building who
// visits on planned rounds, aligned with Dennis's turns, and is called out between rounds only
// for urgent two-person or same-sex personal care.

import { clockToSeconds, timeOfDay } from "@vch/shared-types";
import { emit } from "./emit.js";
import { coverableOnSite, isNight, nextCoverT } from "./nightcover.js";
import type { Person, Task, World } from "./state.js";
import { createCare, hasCare } from "./tasks.js";
import { walkTo } from "./world/movement.js";

const IDLE_POST = "Corridor.East";
/** Only call her out if the next round (or the day shift) is further away than this. */
const CALL_OUT_IF_COVER_AFTER_MINS = 30;
/** While on site she also helps with anything due within this many minutes. */
const PRESSING_MINS = 20;
/** Peggy's pad is changed on a round if toileting has reached this. */
const PAD_CHANGE_DUE = 0.4;

export function floatPerson(world: World): Person {
  return world.people.get(world.data.rota.night_float.id)!;
}

/** Urgent: toileting or incontinence care. */
function urgent(task: Task): boolean {
  return (task.kind === "assist" && task.need === "toileting") || (task.kind === "care" && task.data.care === "pad_change");
}

/** Work that can't be done without her (two-person or female-only with no one else able). */
function needsHer(world: World, task: Task): boolean {
  return (task.kind === "assist" || task.kind === "care") && !coverableOnSite(world, task);
}

/** The work batched on a planned round (docs/05 "Floating night carer"). */
function roundWork(world: World, hour: number): void {
  for (const id of world.order) {
    const p = world.people.get(id)!;
    const res = p.resident;
    if (!res || !p.onMap) continue;
    const every = res.data.care.reposition_interval_mins.night;
    // Turns anchored to the 22:00 round: Dennis every round, Raj every other.
    if (every && ((hour - 22 + 24) % 24) % (every / 60) === 0 && res.inBed && !hasCare(world, p.id, "reposition")) {
      createCare(world, p, "reposition", { dueT: world.t + 30 * 60 });
    }
    if (res.data.care.female_carers_only && res.inBed && res.needs.toileting >= PAD_CHANGE_DUE && !hasCare(world, p.id, "pad_change") && !res.requestId) {
      createCare(world, p, "pad_change", { dueT: world.t + 30 * 60 });
    }
  }
}

export function comeIn(world: World, planned: boolean, delayMins: number): void {
  world.float = { status: "coming", arriveT: world.t + delayMins * 60, planned };
}

export function floatMinute(world: World): void {
  const me = floatPerson(world);
  const t = world.t;
  const tod = timeOfDay(t);

  // Planned rounds.
  if (isNight(t) && world.data.rota.night_float.rounds.some((r) => clockToSeconds(r) === tod)) {
    roundWork(world, Math.floor(tod / 3600));
    if (world.float.status === "off") comeIn(world, true, 0);
  }

  // Out-of-round call-outs for urgent care nobody on site can do.
  const f = world.float; // read after any planned arrival above
  if (isNight(t) && f.status === "off") {
    const waiting = [...world.tasks.values()].filter((task) => task.status === "open" && urgent(task) && needsHer(world, task));
    if (waiting.length > 0 && nextCoverT(world, t) - t > CALL_OUT_IF_COVER_AFTER_MINS * 60) {
      world.metrics.floatCallouts += 1;
      emit(world, "second_carer.called", [me.id], { reason: "urgent personal care", residentIds: waiting.map((w) => w.residentId!).sort(), outOfRound: true });
      comeIn(world, false, world.rng.decisions.int(8, 12));
    }
  }

  if (f.status === "coming" && t >= f.arriveT!) {
    f.status = "on_site";
    me.staff!.duty = "arriving";
    world.spawnQueue.push(me.id);
  }

  // She goes back to the main building once nothing here needs her and nothing is pressing.
  if (f.status === "on_site" && me.onMap && me.staff!.duty === "on_shift" && !me.staff!.taskId) {
    const pressing = (task: Task) => task.status === "open" && (task.request || (task.deadlineT !== null && task.deadlineT - t <= PRESSING_MINS * 60));
    // A fall in progress keeps her here: the night carer may be tied up with it.
    const stillNeeded = [...world.tasks.values()].some((task) => (needsHer(world, task) && task.status !== "done") || pressing(task) || task.kind === "fall");
    if (!stillNeeded) {
      f.status = "leaving";
      me.staff!.duty = "leaving";
      me.badges = [];
      me.task = null;
      walkTo(world, me, "ExitDoor");
    } else if (!me.move && me.atPoint !== IDLE_POST) {
      walkTo(world, me, IDLE_POST);
    }
  }
}

/** Called when she appears at the exit door. */
export function floatArrived(world: World, me: Person): void {
  me.staff!.duty = "on_shift";
  emit(world, "second_carer.arrived", [me.id], { personId: me.id, planned: world.float.planned });
  walkTo(world, me, IDLE_POST);
}

/** Called when she leaves through the exit door. */
export function floatDeparted(world: World, me: Person): void {
  world.float = { status: "off", arriveT: null, planned: false };
  emit(world, "second_carer.departed", [me.id], { personId: me.id });
}

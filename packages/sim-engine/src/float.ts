// The floating night carer (spec decision 16): a female carer from the main building who
// visits on planned rounds, aligned with Dennis's turns, and is called out between rounds only
// for urgent two-person or same-sex personal care.

import { tuned } from "./tuning.js";
import { clockToSeconds, timeOfDay } from "@vch/shared-types";
import { FLOAT_TURNS } from "./care.js";
import { emit } from "./emit.js";
import { coverableOnSite, isNight, nextCoverT } from "./nightcover.js";
import { isCareStaff, unwell, type Person, type Task, type World } from "./state.js";
import { createCare, hasCare, nightBreakOn, nightBreakWaiting, pullOff } from "./tasks.js";
import { walkTo } from "./world/movement.js";

const IDLE_POST = "Corridor.East";
/** Only call her out if the next round (or the day shift) is further away than this. */
const CALL_OUT_IF_COVER_AFTER_MINS = 30;
/** She arrives this long before a turn is due so it starts on time (and takes open tasks, e.g. checks, meanwhile). */
const ARRIVE_EARLY_MINS = 10;
/** A turn takes this long (trees.ts careMinutes "reposition"). */
const TURN_MINS = 10;
/** On a round she also turns anyone due within this long (Raj's 4-hourly turn). */
const BATCH_TURNS_WITHIN_MINS = 70;
/** While on site she also helps with anything due within this many minutes. */
const PRESSING_MINS = 20;
/** Peggy's pad is changed on a round if toileting has reached this. */
const PAD_CHANGE_DUE = 0.4;

/** The 07:00 handover takes the night carer off the floor: turns due around it are done before it. */
const MORNING_HANDOVER = { from: clockToSeconds("06:45"), until: clockToSeconds("07:30") };

/** When a turn should be started by: its due time, or 06:45 if it falls due during the morning handover. */
function plannedBy(world: World, due: number): number {
  if (!tuned(world, "float_planning")) return due;
  const tod = timeOfDay(due);
  return tod >= MORNING_HANDOVER.from && tod < MORNING_HANDOVER.until ? due - tod + MORNING_HANDOVER.from : due;
}

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

/** In the floating carer's cover window (turns due from 21:30 to 08:00). */
function floatCovers(due: number): boolean {
  const tod = timeOfDay(due);
  return tod >= FLOAT_TURNS.from || tod < FLOAT_TURNS.until;
}

/** Next night turn due for each in-bed resident who needs turning at night. */
function nightTurnsDue(world: World): { p: Person; due: number }[] {
  const out: { p: Person; due: number }[] = [];
  for (const id of world.order) {
    const p = world.people.get(id)!;
    const res = p.resident;
    const every = res?.data.care.reposition_interval_mins.night;
    if (!res || !p.onMap || !res.inBed || !every) continue;
    const due = res.lastTurnedT + every * 60;
    if (floatCovers(due)) out.push({ p, due });
  }
  return out;
}

/** The work batched on a round (docs/05 "Floating night carer"). */
function roundWork(world: World): void {
  for (const { p, due } of nightTurnsDue(world)) {
    // Turn anyone due within the batching window: Dennis on every round, Raj on the round before his 4 hours are up.
    if (due - world.t <= BATCH_TURNS_WITHIN_MINS * 60 && !hasCare(world, p.id, "reposition")) createCare(world, p, "reposition", { dueT: due });
  }
  for (const id of world.order) {
    const p = world.people.get(id)!;
    const res = p.resident;
    if (res?.data.care.female_carers_only && p.onMap && res.inBed && res.needs.toileting >= PAD_CHANGE_DUE && !hasCare(world, p.id, "pad_change") && !res.requestId) {
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

  // Planned rounds, aligned with Dennis's turns: she comes about 10 minutes before the latest time
  // that still lets the turns falling due together each start on time, one after another.
  const upcoming = nightTurnsDue(world).filter((d) => !hasCare(world, d.p.id, "reposition")).sort((a, b) => a.due - b.due);
  const batch = upcoming.filter((d) => upcoming[0] && d.due - upcoming[0].due <= BATCH_TURNS_WITHIN_MINS * 60);
  // (Without the tuning rule: she comes for the first turn due, not planning the batch back to back.)
  const startBy = tuned(world, "float_planning") ? Math.min(...batch.map((d, i) => plannedBy(world, d.due) - i * TURN_MINS * 60)) : Math.min(...batch.map((d) => d.due));
  const due = batch.length > 0 && t >= startBy - ARRIVE_EARLY_MINS * 60 ? batch : [];
  if (due.length > 0 && world.float.status === "off") {
    roundWork(world);
    comeIn(world, true, 0);
  } else if (due.length > 0 && world.float.status !== "off") {
    roundWork(world); // still here (or on her way): pick up the next turns
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
  const doing = me.staff!.taskId ? world.tasks.get(me.staff!.taskId) : undefined;
  if (f.status === "on_site" && me.onMap && me.staff!.duty === "on_shift" && (!doing || doing.kind === "idle")) {
    const pressing = (task: Task) => task.status === "open" && (task.request || (task.deadlineT !== null && task.deadlineT - t <= PRESSING_MINS * 60));
    // A fall in progress keeps her here: the night carer may be tied up with it.
    // She stays for the round's turns, and while a fall is in progress.
    const roundTurn = (task: Task) => task.kind === "care" && task.data.care === "reposition" && floatCovers(task.deadlineT ?? 0);
    // And she covers the wing for the night carer's break, once it's due, until it's over.
    // Covering for a night carer taken ill, until the cover from the main building is on the floor.
    const wellCarer = world.order.some((id) => {
      const q = world.people.get(id)!;
      return q.id !== me.id && isCareStaff(q) && q.onMap && q.staff!.duty === "on_shift" && !!q.staff!.shift && !unwell(q);
    });
    const stillNeeded = (isNight(t) && !wellCarer) || nightBreakOn(world) || nightBreakWaiting(world) || [...world.tasks.values()].some((task) => (needsHer(world, task) && task.status !== "done") || pressing(task) || roundTurn(task) || task.kind === "fall");
    if (!stillNeeded) {
      if (doing) pullOff(world, me, "going back to the main building");
      f.status = "leaving";
      me.staff!.duty = "leaving";
      me.badges = [];
      me.task = null;
      walkTo(world, me, "ExitDoor");
    } else if (!me.move && me.atPoint !== IDLE_POST && !doing) {
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

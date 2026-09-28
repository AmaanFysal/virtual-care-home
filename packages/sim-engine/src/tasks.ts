// Tasks: the wing's work queue (docs/04 "Tasks and utility"). Help requests become `assist`
// tasks; the care schedule adds bedside `care` and drinks `round`s; the rota adds handovers,
// briefings and breaks. Each minute, free staff are matched to open tasks by utility score;
// every tick, active tasks advance their behaviour tree (trees.ts).

import type { DrinkRound, MealName, NeedName } from "@vch/shared-types";
import { newBtState, tickTree, type Status } from "./bt.js";
import { emit } from "./emit.js";
import { breakInterruptible, coveredWithout } from "./floor.js";
import { coverableOnSite, isNight, requestDeadline } from "./nightcover.js";
import { isCareStaff, isNurse, onDuty, type CareKind, type Person, type Task, type TaskKind, type World } from "./state.js";
import type { Ctx } from "./trees.js";
import { TREES } from "./treeset.js";
import { startIdleActivity } from "./idle.js";
import { walkTo } from "./world/movement.js";

const NEED_LABEL: Record<NeedName, string> = { hunger: "Snack", thirst: "Drink", toileting: "Toilet", fatigue: "Rest", social: "Chat" };
const STAFF_ROOM_SEATS = ["StaffRoom.Seat1", "StaffRoom.Seat2", "StaffRoom.Seat3", "StaffRoom.Seat4", "StaffRoom.Seat5", "StaffRoom.Seat6"];

/** Base priorities (docs/04 "Tasks and utility"). Requests add 100 × need on top. */
const PRIORITY = { request: 40, prompt: 90, check: 70, reposition: 85, pad_change: 85, meal: 75, morning: 60, bedtime: 60, round: 70 } as const;

// ---------------------------------------------------------------- creation

function newTask(world: World, kind: TaskKind, fields: Partial<Task> & { label: string }): Task {
  world.taskSeq += 1;
  const task: Task = {
    id: `t${String(world.taskSeq).padStart(6, "0")}`,
    kind,
    residentId: null,
    need: null,
    createdT: world.t,
    startedT: null,
    staffNeeded: 1,
    femaleOnly: false,
    priority: 0,
    request: false,
    deadlineT: null,
    members: null,
    assigned: [],
    status: "open",
    bt: newBtState(),
    data: {},
    ...fields,
  };
  world.tasks.set(task.id, task);
  return task;
}

function firstName(p: Person): string {
  return p.name.split(" ")[0]!;
}

/**
 * Help with one need. `request` is the resident asking (docs/05 decision 10); otherwise it is
 * scheduled (Peggy's prompted toileting). Toileting is personal care: pads mean a bedside change
 * with `personal_care_staff` people; Peggy is walked to the WC; female-only rules apply.
 */
export function createAssist(world: World, resident: Person, need: NeedName, request = true): Task {
  const res = resident.resident!;
  const care = res.data.care;
  const personal = need === "toileting";
  const escort = personal && care.toileting === "prompted" && resident.speed > 0;
  const task = newTask(world, "assist", {
    label: `${request ? NEED_LABEL[need] : "Toilet prompt"} for ${firstName(resident)}`,
    residentId: resident.id,
    need,
    staffNeeded: personal ? care.personal_care_staff : 1,
    femaleOnly: personal && care.female_carers_only,
    priority: request ? PRIORITY.request : PRIORITY.prompt,
    request,
    data: { method: escort ? "escort" : "bedside" },
  });
  if (request) {
    task.deadlineT = requestDeadline(world, task);
    res.requestId = task.id;
    world.shiftLog.get(resident.id)!.helpRequests += 1;
    emit(world, "resident.requested_help", [resident.id], { residentId: resident.id, need, taskId: task.id });
  }
  emit(world, "task.created", [resident.id], { taskId: task.id, kind: "assist", residentId: resident.id, dueT: world.t });
  return task;
}

const CARE_LABEL: Record<CareKind, string> = {
  morning: "Morning care",
  bedtime: "Bedtime care",
  check: "Check",
  reposition: "Turn",
  meal: "Meal",
  pad_change: "Pad change",
};

/** Scheduled care at the resident's bed or chair (docs/05 "Procedures"). */
export function createCare(world: World, resident: Person, care: CareKind, extra: { meal?: MealName; dueT?: number } = {}): Task {
  const c = resident.resident!.data.care;
  const twoPerson = care === "reposition" || ((care === "morning" || care === "bedtime") && c.personal_care_staff === 2);
  const personal = care === "morning" || care === "bedtime" || care === "pad_change";
  const task = newTask(world, "care", {
    label: `${extra.meal ? extra.meal[0]!.toUpperCase() + extra.meal.slice(1) : CARE_LABEL[care]} for ${firstName(resident)}`,
    residentId: resident.id,
    staffNeeded: twoPerson ? 2 : 1,
    femaleOnly: personal && c.female_carers_only,
    // Post-fall observations come before routine care.
    priority: care === "check" && resident.resident!.postFallUntil > world.t ? 95 : PRIORITY[care],
    deadlineT: extra.dueT ?? null,
    data: { care, meal: extra.meal ?? null },
  });
  emit(world, "task.created", [resident.id], { taskId: task.id, kind: `care.${care}`, residentId: resident.id, dueT: extra.dueT ?? world.t });
  return task;
}

/** A drinks round: one carer takes tea and a biscuit to each resident in turn. */
export function createDrinksRound(world: World, round: DrinkRound, residentIds: string[]): Task {
  const task = newTask(world, "round", { label: "Drinks round", priority: PRIORITY.round, data: { round, residents: residentIds } });
  emit(world, "task.created", [], { taskId: task.id, kind: "round", residentId: null, dueT: world.t });
  return task;
}

/** An independent resident takes themselves to the WC and back. */
export function createSelfToilet(world: World, resident: Person): Task {
  const res = resident.resident!;
  const task = newTask(world, "self_toilet", {
    label: "Going to the toilet",
    residentId: resident.id,
    need: "toileting",
    status: "active",
    startedT: world.t,
    data: { wc: `${resident.roomId}.WC`, returnToBed: res.inBed ? 1 : 0, returnTo: res.inBed ? `${res.data.room}.Side` : (resident.atPoint ?? `${res.data.room}.Chair`) },
  });
  res.busyTaskId = task.id;
  resident.task = task.label;
  return task;
}

export function createHandover(world: World, from: string[], to: string[], cover: string | null, durationMins: number, briefCover: boolean): Task {
  const members = [...from, ...to];
  const task = newTask(world, "handover", { label: "Handover", members, data: { from, to, cover, durationMins, briefCover: briefCover ? 1 : 0 } });
  emit(world, "task.created", members, { taskId: task.id, kind: "handover", residentId: null, dueT: world.t });
  return task;
}

export function createBriefing(world: World, lead: string, cover: string): Task {
  return newTask(world, "briefing", { label: "Briefing after handover", members: [lead, cover], data: { lead, cover } });
}

function createBreak(world: World, interruptible: boolean): Task {
  const point = interruptible ? "WaitingArea.Seat8" : STAFF_ROOM_SEATS[STAFF_ROOM_SEATS.length - 1]!;
  return newTask(world, "break", { label: "Break", data: { remainingMins: 30, point, interruptible: interruptible ? 1 : 0, resumed: 0 } });
}

/** Open or active scheduled care of a kind for a resident (so it isn't created twice). */
export function hasCare(world: World, residentId: string, care: CareKind): boolean {
  for (const t of world.tasks.values()) if (t.residentId === residentId && t.kind === "care" && t.data.care === care) return true;
  return false;
}

// ---------------------------------------------------------------- running

export function finish(world: World, task: Task, status: Status): void {
  task.status = "done";
  for (const id of task.assigned) {
    const p = world.people.get(id)!;
    if (p.staff?.taskId === task.id) p.staff.taskId = null;
    p.badges = [];
    p.task = null;
  }
  const resident = task.residentId ? world.people.get(task.residentId)! : null;
  if (resident?.resident) {
    if (resident.resident.requestId === task.id) resident.resident.requestId = null;
    if (resident.resident.busyTaskId === task.id) resident.resident.busyTaskId = null;
    if (task.kind === "self_toilet") resident.task = null;
  }
  if (task.kind !== "self_toilet" && task.kind !== "break" && task.kind !== "idle") {
    const waitMins = Math.round(((task.startedT ?? world.t) - task.createdT) / 60);
    const actors = task.residentId ? [...task.assigned, task.residentId] : task.assigned;
    const kind = task.kind === "care" ? `care.${task.data.care}` : task.kind;
    if (status === "success") emit(world, "task.completed", actors, { taskId: task.id, kind, residentId: task.residentId, waitMins });
    else emit(world, "task.interrupted", actors, { taskId: task.id, kind, reason: "failed" });
  }
  world.tasks.delete(task.id);
}

/** Advances every active task's behaviour tree by one tick, in task-id order. */
export function runTasks(world: World): void {
  for (const task of [...world.tasks.values()]) {
    if (task.status !== "active") continue;
    const ctx: Ctx = {
      world,
      task,
      staff: task.assigned.map((id) => world.people.get(id)!),
      resident: task.residentId ? world.people.get(task.residentId)! : null,
    };
    const status = tickTree(TREES[task.kind], ctx, task.bt);
    if (status !== "running") finish(world, task, status);
  }
}

// ---------------------------------------------------------------- interruptions

/**
 * Takes someone off what they are doing (for a fall, or an urgent request). Breaks and
 * medication rounds are paused and resumed later; a med round's interruption raises the chance
 * of a missed dose. Other work goes back on the queue for someone else.
 */
export function pullOff(world: World, p: Person, reason: string): void {
  const task = p.staff?.taskId ? world.tasks.get(p.staff.taskId) : undefined;
  if (!task) return;
  p.staff!.taskId = null;
  p.badges = [];
  p.task = null;
  if (task.kind === "idle") {
    world.tasks.delete(task.id); // idle activities are simply dropped
    return;
  }
  task.assigned = task.assigned.filter((id) => id !== p.id);
  if (task.kind === "break") {
    task.status = "paused";
    task.bt = newBtState();
    task.data.resumed = 1;
    p.staff!.pausedBreakId = task.id;
    return;
  }
  if (task.kind === "med_round") {
    task.status = "paused";
    task.bt = newBtState();
    task.data.interruptions = Number(task.data.interruptions) + 1;
    task.data.phase = 0; // the current resident's dose starts again when the round resumes
    world.metrics.medInterruptions += 1;
    emit(world, "task.interrupted", [p.id], { taskId: task.id, kind: task.kind, reason });
    return;
  }
  if (task.members) return; // handovers and briefings carry on; they'll rejoin when free
  if (task.status === "open") return; // was only holding it for a partner
  resetTask(world, task, reason);
}

/** Puts a task back on the queue (its people are freed; a request keeps its start time). */
export function resetTask(world: World, task: Task, reason: string): void {
  for (const id of task.assigned) {
    const q = world.people.get(id)!;
    if (q.staff?.taskId === task.id) q.staff.taskId = null;
    q.badges = [];
    q.task = null;
  }
  const res = task.residentId ? world.people.get(task.residentId)!.resident : null;
  if (res?.busyTaskId === task.id) res.busyTaskId = null;
  task.assigned = [];
  task.status = "open";
  task.bt = newBtState();
  task.data.phase = null;
  emit(world, "task.interrupted", task.residentId ? [task.residentId] : [], { taskId: task.id, kind: task.kind, reason });
}

// ---------------------------------------------------------------- assignment

function assign(world: World, task: Task, people: Person[]): void {
  for (const p of people) {
    pullOff(world, p, `called to ${task.label}`);
    p.staff!.taskId = task.id;
    task.assigned.push(p.id);
  }
  const full = task.members ? task.assigned.length > 0 : task.assigned.length >= task.staffNeeded;
  if (task.status === "open" && full) {
    task.status = "active";
    if (task.residentId && (task.kind === "assist" || task.kind === "care")) {
      world.people.get(task.residentId)!.resident!.busyTaskId = task.id;
      emit(world, "task.assigned", [...task.assigned, task.residentId], { taskId: task.id, kind: task.kind, staffIds: [...task.assigned] });
    }
  } else if (task.status === "open" && task.residentId) {
    // Holding a two-person task for a partner: wait in the corridor outside the room.
    const room = world.people.get(task.residentId)!.resident!.data.room.split(".")[0];
    for (const p of people) walkTo(world, p, room === "Room1" ? "Corridor.West" : "Corridor.Mid");
  }
}

/** Covering the floor for a handover that hasn't finished (still working, even past shift end). */
function coveringHandover(world: World, p: Person): boolean {
  return [...world.tasks.values()].some((t) => t.kind === "handover" && t.data.cover === p.id);
}

/** Doing an idle activity (or nothing): free for any real work. */
export function idleOrFree(world: World, p: Person): boolean {
  return !p.staff?.taskId || world.tasks.get(p.staff.taskId)?.kind === "idle";
}

/** Free for new work: on duty, shift under way, no task (or on an interruptible break). */
function isFree(world: World, p: Person, allowBreak: boolean): boolean {
  if (!isCareStaff(p)) return false;
  if (p.staff!.duty !== "on_shift" && !(p.staff!.duty === "staying" && coveringHandover(world, p))) return false;
  if (idleOrFree(world, p)) return true;
  return allowBreak && breakInterruptible(world, p);
}

/**
 * Can be called away for a request about to go over its limit: on a medication round, or
 * holding a two-person task at the bedside while waiting for a partner.
 */
function interruptibleForUrgent(world: World, p: Person): boolean {
  const task = p.staff?.taskId ? world.tasks.get(p.staff.taskId) : undefined;
  if (!task || (p.staff!.duty !== "on_shift" && p.staff!.duty !== "staying")) return false;
  return (task.kind === "med_round" && p.staff!.duty === "on_shift") || isHeld(task);
}

/** A two-person task held by one person waiting for a partner. */
function isHeld(task: Task): boolean {
  return task.status === "open" && task.assigned.length > 0 && task.assigned.length < task.staffNeeded;
}

/** A request this close to its deadline may interrupt a medication round. */
const INTERRUPT_MEDS_WITHIN_MINS = 10;

function trust(world: World, staffId: string, residentId: string): number {
  const r = world.people.get(residentId)!.resident!.data;
  return r.staff_relationships.find((rel) => rel.staff === staffId)?.trust ?? 0.5;
}

/**
 * A two-person task is waiting, or a two-person turn falls due within 45 minutes, and without
 * `p` fewer than two care staff would be left to do it (so `p` shouldn't go on a break yet).
 */
function twoPersonTurnSoon(world: World, p: Person): boolean {
  const dues: number[] = [];
  for (const t of world.tasks.values()) {
    if (t.kind === "care" && t.data.care === "reposition" && t.deadlineT !== null) dues.push(t.deadlineT);
    else if (t.staffNeeded === 2 && t.status === "open" && (t.kind === "assist" || t.kind === "care")) dues.push(world.t); // waiting now
  }
  for (const id of world.order) {
    const res = world.people.get(id)!.resident;
    const every = res?.data.care.reposition_interval_mins.day;
    if (res && every && res.inBed) dues.push(res.lastTurnedT + every * 60);
  }
  const due = dues.filter((d) => d - world.t <= 45 * 60).sort((a, b) => a - b)[0];
  if (due === undefined) return false;
  // Others who will still be here and free of breaks when it's due.
  const others = world.order
    .map((id) => world.people.get(id)!)
    .filter((q) => q.id !== p.id && isCareStaff(q) && q.staff!.duty === "on_shift" && q.onMap && (q.staff!.shift?.endT ?? Infinity) > due && world.tasks.get(q.staff!.taskId ?? "")?.kind !== "break");
  return others.length < 2;
}

/** Utility of one staff member taking one task (docs/04). Higher is better. */
export function taskScore(world: World, p: Person, task: Task): number {
  const resident = task.residentId ? world.people.get(task.residentId)! : null;
  // Waiting raises a task's claim, but only so far: a long-waiting routine task shouldn't beat a check that's due.
  let score = task.priority + Math.min(60, 1.5 * ((world.t - task.createdT) / 60));
  if (task.request && resident) score += 100 * resident.resident!.needs[task.need!];
  // Deadlines: hard ones (checks, requests) press harder the closer they get; soft ones
  // (turns, pad changes) nudge a little.
  if (task.deadlineT !== null) {
    const hard = task.request || (task.kind === "care" && (task.data.care === "check" || task.data.care === "reposition"));
    const window = hard ? 20 : 15;
    const left = (task.deadlineT - world.t) / 60;
    if (left < window) score += hard ? 60 + 6 * (window - Math.max(0, left)) : 30;
    // An overdue turn keeps climbing (pressure-ulcer risk).
    if (!hard && left < 0) score += 3 * Math.min(40, -left);
  }
  if (resident) {
    score -= 3 * Math.hypot(p.x - resident.x, p.y - resident.y);
    score += 10 * trust(world, p.id, resident.id);
  }
  if (isNurse(p)) score -= 25; // nurses help, but carers go first
  if (p.staff!.taskId) score -= 10; // on an interruptible break or a medication round
  return score;
}

export function decideStaff(world: World): void {
  const staff = world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap && p.staff && onDuty(p));
  const tasks = [...world.tasks.values()];

  // 1. Handovers and briefings claim their members as soon as they are free, including outgoing
  //    staff whose shift has technically ended (they still owe the handover).
  const memberFree = (p: Person) => isCareStaff(p) && idleOrFree(world, p) && (p.staff!.duty === "on_shift" || p.staff!.duty === "staying");
  for (const task of tasks.filter((t) => t.members && t.status !== "done")) {
    if (task.kind === "briefing") {
      // Whoever is free first waits up to 5 minutes for the other; after an hour it's skipped and
      // the written handover notes stand in.
      const waiting = task.assigned.length === 1 && task.startedT === null;
      if (task.assigned.length < 2 && world.t - task.createdT > 60 * 60) {
        resetTask(world, task, "briefing skipped: handover notes instead");
        world.tasks.delete(task.id);
        continue;
      }
      if (waiting && world.t - Number(task.data.heldSince) > 5 * 60) {
        resetTask(world, task, "partner still busy");
        continue;
      }
      for (const p of task.members!.map((id) => world.people.get(id)!)) {
        if (!task.assigned.includes(p.id) && p.onMap && memberFree(p)) {
          if (task.assigned.length === 0) task.data.heldSince = world.t;
          assign(world, task, [p]);
        }
      }
      continue;
    }
    for (const p of staff) {
      const free = memberFree(p);
      if (!task.members!.includes(p.id) || task.assigned.includes(p.id) || !free) continue;
      if (task.status === "paused") {
        task.status = "open"; // a medication round picks up where it stopped
        emit(world, "task.resumed", [p.id], { taskId: task.id, kind: task.kind });
      }
      assign(world, task, [p]);
    }
  }

  // 2. Resume a paused break, or start a due one if the floor stays covered.
  for (const p of staff) {
    const s = p.staff!;
    // Office and reception staff take lunch too; they don't cover the floor, so no cover check.
    if (s.duty !== "on_shift" || !idleOrFree(world, p) || !s.shift?.started) continue;
    if (s.pausedBreakId) {
      const paused = world.tasks.get(s.pausedBreakId)!;
      s.pausedBreakId = null;
      paused.status = "open";
      paused.assigned = [];
      assign(world, paused, [p]);
      continue;
    }
    if (s.breakTaken || s.breakDueT === null || world.t < s.breakDueT) continue;
    const sole = s.shift?.shift === "night";
    // Day staff wait for a two-person turn that's nearly due; the lone night carer's break is in
    // the wing and interruptible, and night turns are done with the floating carer.
    if (isCareStaff(p) && !sole && twoPersonTurnSoon(world, p)) continue;
    if (!isCareStaff(p) || sole || coveredWithout(world, p, true)) assign(world, createBreak(world, sole), [p]);
  }

  // 3. Work: repeatedly take the best (task, staff) match.
  const open = tasks.filter((t) => (t.kind === "assist" || t.kind === "care" || t.kind === "round" || t.kind === "let_in") && t.status === "open").sort((a, b) => a.id.localeCompare(b.id));
  const night = isNight(world.t);
  // Only one two-person task may be held by a lone carer at a time, or two carers can end up
  // each holding a different one, waiting for each other for ever.
  let holding = open.some((t) => t.status === "open" && t.assigned.length > 0);
  for (;;) {
    let best: { task: Task; people: Person[]; score: number } | null = null;
    for (const task of open) {
      if (task.status !== "open" || task.data.absorbedBy) continue;
      const resident = task.residentId ? world.people.get(task.residentId)!.resident! : null;
      if (resident?.busyTaskId && resident.busyTaskId !== task.id) continue; // one thing at a time
      const needed = task.staffNeeded - task.assigned.length;
      const targetTask = task.request || (task.kind === "care" && (task.data.care === "check" || task.data.care === "reposition"));
      const urgent = targetTask && task.deadlineT !== null && task.deadlineT - world.t <= INTERRUPT_MEDS_WITHIN_MINS * 60;
      const eligible = (p: Person) => !task.assigned.includes(p.id) && (!task.femaleOnly || p.gender === "female");
      // Someone whose shift has ended stays to do what only they can (e.g. the last woman on the wing).
      const current = (p: Person) => (p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined);
      const onlyThem = (p: Person) =>
        task.request && p.staff!.duty === "staying" && isCareStaff(p) && (!current(p) || isHeld(current(p)!)) && !coverableOnSite(world, task);
      let pool = staff.filter((p) => eligible(p) && (isFree(world, p, true) || onlyThem(p)));
      if (urgent && pool.length < needed) pool = [...pool, ...staff.filter((p) => eligible(p) && isCareStaff(p) && interruptibleForUrgent(world, p))];
      const candidates = pool
        .map((p) => ({ p, score: taskScore(world, p, task) }))
        .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
      // Hold a waiting two-person task with one person rather than let it starve: by day after
      // 5 minutes, and at any time for a turn about to go over its interval.
      const pressing = task.kind === "care" && task.data.care === "reposition" && task.deadlineT !== null && task.deadlineT - world.t <= 15 * 60;
      const reserve = !holding && needed === 2 && candidates.length === 1 && ((!night && world.t - task.createdT >= 5 * 60) || pressing);
      if (candidates.length < needed && !reserve) continue;
      const chosen = candidates.slice(0, reserve ? 1 : needed);
      const score = chosen.reduce((sum, c) => sum + c.score, 0) / chosen.length;
      if (!best || score > best.score) best = { task, people: chosen.map((c) => c.p), score };
    }
    if (!best) break;
    assign(world, best.task, best.people);
    if (best.task.status === "open") holding = true;
  }

  // 4. Anyone still free takes up a low-priority activity (not the handover's floor cover).
  for (const p of staff) {
    if (p.staff!.duty !== "on_shift" || p.staff!.taskId || !p.staff!.shift?.started || coveringHandover(world, p)) continue;
    startIdleActivity(world, p);
  }

  // 5. Workload: rolling share of the last hour spent on work.
  for (const p of staff) {
    const task = p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined;
    const busy = task && task.kind !== "break" && task.kind !== "idle" ? 1 : 0;
    p.staff!.workload += (busy - p.staff!.workload) / 60;
  }
}

/** On-shift staff with nothing to do. */
export function idleStaff(world: World): Person[] {
  return world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap && p.staff && p.staff.duty === "on_shift" && !p.staff.taskId);
}

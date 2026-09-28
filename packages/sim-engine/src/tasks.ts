// Tasks: the wing's work queue (docs/04 "Tasks and utility"). Help requests become `assist`
// tasks; the care schedule adds bedside `care` and drinks `round`s; the rota adds handovers,
// briefings and breaks. Each minute, free staff are matched to open tasks by utility score;
// every tick, active tasks advance their behaviour tree (trees.ts).

import type { DrinkRound, MealName, NeedName } from "@vch/shared-types";
import { newBtState, tickTree, type Status } from "./bt.js";
import { emit } from "./emit.js";
import { breakInterruptible, coveredWithout } from "./floor.js";
import { isNight, requestDeadline } from "./nightcover.js";
import { isCareStaff, isNurse, onDuty, type CareKind, type Person, type Task, type TaskKind, type World } from "./state.js";
import { TREES, type Ctx } from "./trees.js";
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
    priority: PRIORITY[care],
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
  if (task.kind !== "self_toilet" && task.kind !== "break") {
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

// ---------------------------------------------------------------- assignment

function assign(world: World, task: Task, people: Person[]): void {
  for (const p of people) {
    const current = p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined;
    if (current?.kind === "break") {
      // Only a sole night carer's break is interruptible: pause it and come back to it.
      current.status = "paused";
      current.bt = newBtState();
      current.data.resumed = 1;
      p.staff!.pausedBreakId = current.id;
    }
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
    // Holding a two-person task for a partner: wait at the bedside.
    const bed = world.people.get(task.residentId)!.resident!.data.room;
    for (const p of people) walkTo(world, p, `${bed}.Side`);
  }
}

/** Free for new work: on duty, shift under way, no task (or on an interruptible break). */
function isFree(world: World, p: Person, allowBreak: boolean): boolean {
  if (!isCareStaff(p) || p.staff!.duty !== "on_shift") return false;
  if (!p.staff!.taskId) return true;
  return allowBreak && breakInterruptible(world, p);
}

function trust(world: World, staffId: string, residentId: string): number {
  const r = world.people.get(residentId)!.resident!.data;
  return r.staff_relationships.find((rel) => rel.staff === staffId)?.trust ?? 0.5;
}

/** Utility of one staff member taking one task (docs/04). Higher is better. */
export function taskScore(world: World, p: Person, task: Task): number {
  const resident = task.residentId ? world.people.get(task.residentId)! : null;
  let score = task.priority + 1.5 * ((world.t - task.createdT) / 60);
  if (task.request && resident) score += 100 * resident.resident!.needs[task.need!];
  if (task.deadlineT !== null && task.deadlineT - world.t < 15 * 60) score += 60;
  if (resident) {
    score -= 3 * Math.hypot(p.x - resident.x, p.y - resident.y);
    score += 10 * trust(world, p.id, resident.id);
  }
  if (isNurse(p)) score -= 25; // nurses help, but carers go first
  if (p.staff!.taskId) score -= 10; // on an interruptible break
  return score;
}

export function decideStaff(world: World): void {
  const staff = world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap && p.staff && onDuty(p));
  const tasks = [...world.tasks.values()];

  // 1. Handovers and briefings claim their members as soon as they are free, including outgoing
  //    staff whose shift has technically ended (they still owe the handover).
  for (const task of tasks.filter((t) => t.members && t.status !== "done")) {
    for (const p of staff) {
      const free = isCareStaff(p) && !p.staff!.taskId && (p.staff!.duty === "on_shift" || p.staff!.duty === "staying");
      if (task.members!.includes(p.id) && !task.assigned.includes(p.id) && free) assign(world, task, [p]);
    }
  }

  // 2. Resume a paused break, or start a due one if the floor stays covered.
  for (const p of staff) {
    const s = p.staff!;
    // Office and reception staff take lunch too; they don't cover the floor, so no cover check.
    if (s.duty !== "on_shift" || s.taskId || !s.shift?.started) continue;
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
    if (!isCareStaff(p) || sole || coveredWithout(world, p, true)) assign(world, createBreak(world, sole), [p]);
  }

  // 3. Work: repeatedly take the best (task, staff) match.
  const open = tasks.filter((t) => (t.kind === "assist" || t.kind === "care" || t.kind === "round") && t.status === "open").sort((a, b) => a.id.localeCompare(b.id));
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
      const candidates = staff
        .filter((p) => !task.assigned.includes(p.id) && isFree(world, p, true) && (!task.femaleOnly || p.gender === "female"))
        .map((p) => ({ p, score: taskScore(world, p, task) }))
        .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
      // By day, hold a waiting two-person task with one person rather than let it starve.
      const reserve = !night && !holding && needed === 2 && candidates.length === 1 && world.t - task.createdT >= 5 * 60;
      if (candidates.length < needed && !reserve) continue;
      const chosen = candidates.slice(0, reserve ? 1 : needed);
      const score = chosen.reduce((sum, c) => sum + c.score, 0) / chosen.length;
      if (!best || score > best.score) best = { task, people: chosen.map((c) => c.p), score };
    }
    if (!best) break;
    assign(world, best.task, best.people);
    if (best.task.status === "open") holding = true;
  }

  // 4. Workload: rolling share of the last hour spent on work.
  for (const p of staff) {
    const task = p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined;
    const busy = task && task.kind !== "break" ? 1 : 0;
    p.staff!.workload += (busy - p.staff!.workload) / 60;
  }
}

/** On-shift staff with nothing to do. */
export function idleStaff(world: World): Person[] {
  return world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap && p.staff && p.staff.duty === "on_shift" && !p.staff.taskId);
}

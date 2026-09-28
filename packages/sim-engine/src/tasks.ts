// Tasks: the wing's work queue (docs/04 "Tasks and utility"). Residents' help requests become
// `assist` tasks; the rota adds handovers, briefings and breaks. Each minute, free staff are
// matched to open tasks by utility score; every tick, active tasks advance their behaviour tree.

import type { Badge, NeedName } from "@vch/shared-types";
import { act, leaf, newBtState, sel, seq, tickTree, until, type BtNode, type Status } from "./bt.js";
import { emit } from "./emit.js";
import { breakInterruptible, coveredWithout, onFloor } from "./floor.js";
import { isCareStaff, isNurse, onDuty, type Person, type Task, type TaskKind, type World } from "./state.js";
import { getIntoBed, getOutOfBed, walkTo } from "./world/movement.js";

interface Ctx {
  world: World;
  task: Task;
  staff: Person[];
  resident: Person | null;
}

const NEED_LABEL: Record<NeedName, string> = { hunger: "Snack", thirst: "Drink", toileting: "Toilet", fatigue: "Rest", social: "Chat" };
const NEED_BADGE: Record<NeedName, Badge> = { hunger: "tray", thirst: "cup", toileting: "towel", fatigue: "towel", social: "cup" };
/** Minutes at the bedside for each need (in-bed toileting is a pad change). */
const NEED_MINUTES: Record<NeedName, number> = { hunger: 5, thirst: 3, toileting: 15, fatigue: 5, social: 10 };
const STAFF_ROOM_SEATS = ["StaffRoom.Seat1", "StaffRoom.Seat2", "StaffRoom.Seat3", "StaffRoom.Seat4", "StaffRoom.Seat5", "StaffRoom.Seat6"];

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

function isPersonalCare(need: NeedName): boolean {
  return need === "toileting";
}

/** A resident's help request (docs/05 decision 10). */
export function createAssist(world: World, resident: Person, need: NeedName): Task {
  const res = resident.resident!;
  const care = res.data.care;
  const personal = isPersonalCare(need);
  const escort = need === "toileting" && care.toileting === "prompted" && resident.speed > 0;
  const task = newTask(world, "assist", {
    label: `${NEED_LABEL[need]} for ${resident.name.split(" ")[0]}`,
    residentId: resident.id,
    need,
    staffNeeded: personal ? care.personal_care_staff : 1,
    femaleOnly: personal && care.female_carers_only,
    data: { method: escort ? "escort" : "bedside" },
  });
  res.requestId = task.id;
  world.shiftLog.get(resident.id)!.helpRequests += 1;
  emit(world, "resident.requested_help", [resident.id], { residentId: resident.id, need, taskId: task.id });
  emit(world, "task.created", [resident.id], { taskId: task.id, kind: "assist", residentId: resident.id, dueT: world.t });
  return task;
}

/** An independent resident takes themselves to the WC and back. */
export function createSelfToilet(world: World, resident: Person): Task {
  const res = resident.resident!;
  const wc = `${resident.roomId}.WC`;
  const task = newTask(world, "self_toilet", {
    label: "Going to the toilet",
    residentId: resident.id,
    need: "toileting",
    status: "active",
    startedT: world.t,
    data: { wc, returnToBed: res.inBed ? 1 : 0, returnTo: res.inBed ? `${res.data.room}.Side` : (resident.atPoint ?? `${res.data.room}.Chair`) },
  });
  res.busyTaskId = task.id;
  resident.task = task.label;
  return task;
}

export function createHandover(world: World, from: string[], to: string[], cover: string | null, durationMins: number, briefCover: boolean): Task {
  const members = [...from, ...to];
  const task = newTask(world, "handover", {
    label: "Handover",
    members,
    data: { from, to, cover, durationMins, briefCover: briefCover ? 1 : 0 },
  });
  emit(world, "task.created", members, { taskId: task.id, kind: "handover", residentId: null, dueT: world.t });
  return task;
}

function createBriefing(world: World, lead: string, cover: string): Task {
  return newTask(world, "briefing", { label: "Briefing after handover", members: [lead, cover], data: { lead, cover } });
}

function createBreak(world: World, p: Person, interruptible: boolean): Task {
  const point = interruptible ? "WaitingArea.Seat8" : STAFF_ROOM_SEATS[STAFF_ROOM_SEATS.length - 1]!;
  return newTask(world, "break", { label: "Break", data: { remainingMins: 30, point, interruptible: interruptible ? 1 : 0, resumed: 0 } });
}

// ---------------------------------------------------------------- tree helpers

function waitMins<C extends Ctx>(name: string, mins: (ctx: C) => number): BtNode<C> {
  return leaf(name, (ctx, mem) => {
    if (mem.start === undefined) mem.start = ctx.world.t;
    return ctx.world.t - mem.start! >= mins(ctx) * 60 ? "success" : "running";
  });
}

/** Sends each person to their point once, then runs until all have arrived. */
function goTo<C extends Ctx>(name: string, who: (ctx: C) => Person[], points: (ctx: C) => string[]): BtNode<C> {
  return leaf(name, (ctx) => {
    const people = who(ctx);
    const targets = points(ctx);
    let moving = false;
    people.forEach((p, i) => {
      const target = targets[Math.min(i, targets.length - 1)]!;
      if (p.atPoint !== target) {
        if (!p.move || p.move.destPointId !== target) {
          if (!walkTo(ctx.world, p, target)) return; // unreachable: treat as arrived
        }
        moving = true;
      }
    });
    return moving ? "running" : "success";
  });
}

function setBadges(people: Person[], badges: Badge[], label: string | null): void {
  for (const p of people) {
    p.badges = [...p.badges.filter((b) => b === "asleep"), ...badges];
    if (p.staff) p.task = label;
  }
}

function bedsides(resident: Person): string[] {
  const bed = resident.resident!.data.room;
  return [`${bed}.Side`, `${bed}.Side2`];
}

// ---------------------------------------------------------------- trees

function relieve(ctx: Ctx): void {
  const res = ctx.resident!.resident!;
  const need = ctx.task.need!;
  const relief: Record<NeedName, number> = { hunger: 0.5, thirst: 0.6, toileting: 1, fatigue: 0.3, social: 0.5 };
  res.needs[need] = Math.max(0, res.needs[need] - relief[need]);
  res.needs.social = Math.max(0, res.needs.social - 0.1); // any contact helps a little
  if (need === "thirst") res.fluidsMlToday += 200;
}

/** Succeeds only for the given care method, so the selector falls through to the other one. */
function methodIs(method: string): BtNode<Ctx> {
  return leaf(`method is ${method}?`, (c) => (c.task.data.method === method ? "success" : "failure"));
}

function wcFor(resident: Person): string {
  return `${resident.resident!.data.room.split(".")[0]}.WC`;
}

const assistTree: BtNode<Ctx> = seq(
  "assist",
  goTo("go to resident", (c) => c.staff, (c) => bedsides(c.resident!)),
  act("begin", (c) => {
    c.task.startedT = c.world.t;
    emit(c.world, "task.started", [...c.task.assigned, c.task.residentId!], { taskId: c.task.id, kind: "assist" });
    const badge: Badge = c.task.staffNeeded === 2 ? "hoist" : NEED_BADGE[c.task.need!];
    setBadges(c.staff, [badge], c.task.label);
  }),
  sel(
    "method",
    seq(
      "escort to the WC",
      methodIs("escort"),
      act("set off", (c) => {
        const r = c.resident!;
        c.task.data.returnToBed = r.resident!.inBed ? 1 : 0;
        if (r.resident!.inBed) getOutOfBed(c.world, r);
        walkTo(c.world, r, wcFor(r));
      }),
      goTo("walk with them", (c) => [c.resident!, ...c.staff], (c) => [wcFor(c.resident!)]),
      waitMins("at the WC", () => 5),
      act("done at the WC", relieve),
      goTo("walk back", (c) => [c.resident!, ...c.staff], (c) => bedsides(c.resident!)),
      act("back to bed", (c) => {
        if (c.task.data.returnToBed === 1) getIntoBed(c.world, c.resident!);
      }),
    ),
    seq(
      "at the bedside",
      act("performing", (c) => (c.task.data.phase = "performing")),
      waitMins("care", (c) => NEED_MINUTES[c.task.need!]),
      act("done", (c) => {
        relieve(c);
        c.task.data.phase = null;
      }),
    ),
  ),
);

const selfToiletTree: BtNode<Ctx> = seq(
  "self_toilet",
  act("get up", (c) => {
    if (c.resident!.resident!.inBed) getOutOfBed(c.world, c.resident!);
  }),
  goTo("walk to the WC", (c) => [c.resident!], (c) => [String(c.task.data.wc)]),
  waitMins("on the toilet", () => 3),
  act("done", (c) => (c.resident!.resident!.needs.toileting = 0.05)),
  goTo("walk back", (c) => [c.resident!], (c) => [String(c.task.data.returnTo)]),
  act("settle", (c) => {
    if (c.task.data.returnToBed === 1) getIntoBed(c.world, c.resident!);
  }),
);

function handoverMembersPresent(c: Ctx): boolean {
  const members = c.task.members!;
  const present = (id: string) => {
    const p = c.world.people.get(id);
    return !!p && c.task.assigned.includes(id) && p.roomId === "StaffRoom" && !p.move;
  };
  if (members.every(present)) return true;
  // Don't wait for ever for someone who hasn't turned up: go ahead after 20 minutes.
  const from = c.task.data.from as string[];
  const to = c.task.data.to as string[];
  return c.world.t - c.task.createdT >= 20 * 60 && from.some(present) && to.some(present);
}

const handoverTree: BtNode<Ctx> = seq(
  "handover",
  until("floor covered", (c) => {
    const cover = c.task.data.cover ? c.world.people.get(String(c.task.data.cover)) : undefined;
    return !cover || !onDuty(cover) || onFloor(c.world, cover) || coveredByOthers(c);
  }),
  leaf("gather in the staff room", (c) => {
    c.staff.forEach((p, i) => {
      const seat = STAFF_ROOM_SEATS[i % STAFF_ROOM_SEATS.length]!;
      if (p.atPoint !== seat && p.move?.destPointId !== seat) walkTo(c.world, p, seat);
    });
    return handoverMembersPresent(c) ? "success" : "running";
  }),
  act("start", (c) => {
    c.task.startedT = c.world.t;
    const { from, to, cover } = c.task.data as { from: string[]; to: string[]; cover: string | null };
    setBadges(c.staff, ["handover"], "Handover");
    emit(c.world, "handover.started", c.task.assigned, { from, to, floorCover: cover ?? "" });
  }),
  waitMins("hand over", (c) => Number(c.task.data.durationMins)),
  act("complete", (c) => {
    const { from, to, cover } = c.task.data as { from: string[]; to: string[]; cover: string | null };
    emit(c.world, "handover.completed", c.task.assigned, { from, to, floorCover: cover ?? "", summary: handoverSummary(c.world) });
    for (const log of c.world.shiftLog.values()) Object.assign(log, { falls: 0, lateOrMissedDoses: 0, helpRequests: 0, checksDone: 0 });
    if (c.task.data.briefCover === 1 && cover) createBriefing(c.world, to[0]!, cover);
  }),
);

/** The floor is covered by someone other than the handover's members. */
function coveredByOthers(c: Ctx): boolean {
  return c.world.order.some((id) => !c.task.members!.includes(id) && onFloor(c.world, c.world.people.get(id)!));
}

const briefingTree: BtNode<Ctx> = seq(
  "briefing",
  until("both free", (c) => c.task.assigned.length === 2),
  goTo("meet on the floor", (c) => c.staff, () => ["Corridor.Mid"]),
  act("start", (c) => {
    c.task.startedT = c.world.t;
    setBadges(c.staff, ["handover"], "Briefing");
  }),
  waitMins("brief", () => 5),
);

const breakTree: BtNode<Ctx> = seq(
  "break",
  goTo("go to break spot", (c) => c.staff, (c) => [String(c.task.data.point)]),
  act("start", (c) => {
    setBadges(c.staff, ["break"], "Break");
    if (c.task.data.resumed !== 1) emit(c.world, "break.started", [c.staff[0]!.id], { staffId: c.staff[0]!.id, pointId: String(c.task.data.point) });
  }),
  leaf("rest", (c) => {
    if (c.world.t % 60 === 0) c.task.data.remainingMins = Number(c.task.data.remainingMins) - 1;
    return Number(c.task.data.remainingMins) <= 0 ? "success" : "running";
  }),
  act("end", (c) => {
    c.staff[0]!.staff!.breakTaken = true;
    emit(c.world, "break.ended", [c.staff[0]!.id], { staffId: c.staff[0]!.id });
  }),
);

const TREES: Record<TaskKind, BtNode<Ctx>> = {
  assist: assistTree,
  self_toilet: selfToiletTree,
  handover: handoverTree,
  briefing: briefingTree,
  break: breakTree,
};

function handoverSummary(world: World) {
  return world.data.residents.map((r) => {
    const log = world.shiftLog.get(r.id)!;
    const res = world.people.get(r.id)!.resident!;
    const hoursSince7 = Math.max(0, Math.min(14, ((world.t % 86400) / 3600 - 7 + 24) % 24));
    const expected = (r.nutrition.fluids_target_ml * hoursSince7) / 14;
    return {
      residentId: r.id,
      falls: log.falls,
      lateOrMissedDoses: log.lateOrMissedDoses,
      helpRequests: log.helpRequests,
      fluidsBelowTarget: res.fluidsMlToday < 0.8 * expected,
      checksDone: log.checksDone,
    };
  });
}

// ---------------------------------------------------------------- running

function finish(world: World, task: Task, status: Status): void {
  task.status = "done";
  const staff = task.assigned.map((id) => world.people.get(id)!);
  for (const p of staff) {
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
    if (status === "success") emit(world, "task.completed", actors, { taskId: task.id, kind: task.kind, residentId: task.residentId, waitMins });
    else emit(world, "task.interrupted", actors, { taskId: task.id, kind: task.kind, reason: "failed" });
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
    if (task.kind === "assist") {
      world.people.get(task.residentId!)!.resident!.busyTaskId = task.id;
      emit(world, "task.assigned", [...task.assigned, task.residentId!], { taskId: task.id, kind: task.kind, staffIds: [...task.assigned] });
    }
  }
}

/** Free for new work: on duty, shift under way, no task (or on an interruptible break). */
function isFree(world: World, p: Person, allowBreak: boolean): boolean {
  if (!isCareStaff(p) || p.staff!.duty !== "on_shift") return false;
  if (!p.staff!.taskId) return true;
  return allowBreak && breakInterruptible(world, p);
}

function eligible(p: Person, task: Task): boolean {
  if (task.femaleOnly && p.gender !== "female") return false;
  return true;
}

function trust(world: World, staffId: string, residentId: string): number {
  const r = world.people.get(residentId)!.resident!.data;
  return r.staff_relationships.find((rel) => rel.staff === staffId)?.trust ?? 0.5;
}

/** Utility of one staff member doing one assist (docs/04). Higher is better. */
export function assistScore(world: World, p: Person, task: Task): number {
  const resident = world.people.get(task.residentId!)!;
  const urgency = resident.resident!.needs[task.need!];
  const waitMins = (world.t - task.createdT) / 60;
  const distance = Math.hypot(p.x - resident.x, p.y - resident.y);
  const nurse = isNurse(p) ? 25 : 0; // nurses help, but carers go first
  const onBreak = p.staff!.taskId ? 10 : 0;
  return 100 * urgency + 1.5 * waitMins - 3 * distance + 10 * trust(world, p.id, resident.id) - nurse - onBreak;
}

export function decideStaff(world: World): void {
  const staff = world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap && p.staff && onDuty(p));
  const tasks = [...world.tasks.values()];

  // 1. Handovers and briefings claim their members as soon as they are free.
  for (const task of tasks.filter((t) => t.members && t.status !== "done")) {
    for (const p of staff) {
      if (task.members!.includes(p.id) && !task.assigned.includes(p.id) && isFree(world, p, false)) assign(world, task, [p]);
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
    if (!isCareStaff(p) || sole || coveredWithout(world, p, true)) assign(world, createBreak(world, p, sole), [p]);
  }

  // 3. Assists: repeatedly take the best (task, staff) match.
  const open = tasks.filter((t) => t.kind === "assist" && t.status === "open").sort((a, b) => a.id.localeCompare(b.id));
  for (;;) {
    let best: { task: Task; people: Person[]; score: number } | null = null;
    for (const task of open) {
      if (task.status !== "open") continue;
      const candidates = staff
        .filter((p) => isFree(world, p, true) && eligible(p, task))
        .map((p) => ({ p, score: assistScore(world, p, task) }))
        .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
      if (candidates.length < task.staffNeeded) continue;
      const chosen = candidates.slice(0, task.staffNeeded);
      const score = chosen.reduce((sum, c) => sum + c.score, 0) / chosen.length;
      if (!best || score > best.score) best = { task, people: chosen.map((c) => c.p), score };
    }
    if (!best) break;
    assign(world, best.task, best.people);
  }

  // 4. Workload: rolling share of the last hour spent on work.
  for (const p of staff) {
    const task = p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined;
    const busy = task && task.kind !== "break" ? 1 : 0;
    p.staff!.workload += (busy - p.staff!.workload) / 60;
  }
}

/** Starts newly active tasks' trees on the next tick; returns people with nothing to do. */
export function idleStaff(world: World): Person[] {
  return world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap && p.staff && p.staff.duty === "on_shift" && !p.staff.taskId);
}

// Tasks: the wing's work queue (docs/04 "Tasks and utility"). Help requests become `assist`
// tasks; the care schedule adds bedside `care` and drinks `round`s; the rota adds handovers,
// briefings and breaks. Each minute, free staff are matched to open tasks by utility score;
// every tick, active tasks advance their behaviour tree (trees.ts).

import { tuned } from "./tuning.js";
import { clockToSeconds, timeOfDay, type DrinkRound, type MealName, type NeedName } from "@vch/shared-types";
import { newBtState, tickTree, type Status } from "./bt.js";
import { emit } from "./emit.js";
import { breakInterruptible, coveredWithout, onBreak, onFloor } from "./floor.js";
import { coverableOnSite, isNight, requestDeadline } from "./nightcover.js";
import { chairFor, isCareStaff, isNurse, onDuty, type CareKind, type Person, type Task, type TaskKind, type World } from "./state.js";
import type { Ctx } from "./trees.js";
import { FLOAT_TURNS } from "./care.js";
import { TREES } from "./treeset.js";
import { startIdleActivity } from "./idle.js";

const NEED_LABEL: Record<NeedName, string> = { hunger: "Snack", thirst: "Drink", toileting: "Toilet", fatigue: "Rest", social: "Chat" };
const STAFF_ROOM_SEATS = ["StaffRoom.Seat1", "StaffRoom.Seat2", "StaffRoom.Seat3", "StaffRoom.Seat4", "StaffRoom.Seat5", "StaffRoom.Seat6"];

/** Base priorities (docs/04 "Tasks and utility"). Requests add 100 × need on top. */
const PRIORITY = { request: 40, prompt: 90, check: 70, reposition: 85, pad_change: 85, meal: 75, morning: 60, bedtime: 60, round: 70, tea: 80, comfort: 80, escort: 55, lounge_check: 80 } as const;

/** Which waiting help requests each kind of scheduled care can meet (docs/05 "Procedures"). */
export const MEETS: Record<CareKind, NeedName[]> = {
  morning: ["toileting", "thirst", "hunger", "social"],
  bedtime: ["toileting", "thirst", "hunger", "social"],
  reposition: ["toileting", "thirst", "social"],
  pad_change: ["toileting", "thirst", "social"],
  meal: ["hunger", "thirst", "social"],
  check: ["thirst", "social"],
  tea: ["thirst", "social"],
  comfort: ["thirst", "social"],
  escort: ["social"],
};

function meets(care: Task, need: NeedName): boolean {
  const kind = care.data.care as CareKind;
  return MEETS[kind].includes(need) || (kind === "tea" && need === "hunger" && care.data.toast === 1);
}

/**
 * A waiting help request is dealt with by whoever is doing scheduled care with the resident, if
 * that care can meet it with the people there (a one-person check can't do a two-person change).
 * Called when care begins, and when a request comes in during care already under way (docs/04).
 */
export function absorbInto(world: World, care: Task, request: Task): boolean {
  if (care.kind !== "care" || care.data.absorbed || care.data.effectsDone === 1) return false;
  if (request.status !== "open" || request.startedT !== null || !meets(care, request.need!)) return false;
  const staff = care.assigned.map((id) => world.people.get(id)!);
  if (staff.length < request.staffNeeded) return false;
  if (request.femaleOnly && staff.some((s) => s.gender !== "female")) return false;
  request.startedT = world.t;
  request.data.absorbedBy = care.id;
  care.data.absorbed = request.id;
  return true;
}

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
  // Asked while staff are already with them for care that can meet it: they deal with it there and then.
  const current = res.busyTaskId ? world.tasks.get(res.busyTaskId) : undefined;
  if (request && current?.status === "active" && current.startedT !== null) absorbInto(world, current, task);
  return task;
}

const CARE_LABEL: Record<CareKind, string> = {
  morning: "Morning care",
  bedtime: "Bedtime care",
  check: "Check",
  reposition: "Turn",
  meal: "Meal",
  pad_change: "Pad change",
  tea: "Tea",
  comfort: "Mouth care",
  escort: "Walk",
};

/** Scheduled care at the resident's bed or chair (docs/05 "Procedures"). */
export function createCare(world: World, resident: Person, care: CareKind, extra: { meal?: MealName; dueT?: number; to?: string; toast?: boolean; label?: string; fullLabel?: string; first?: boolean } = {}): Task {
  const c = resident.resident!.data.care;
  const twoPerson = care === "reposition" || ((care === "morning" || care === "bedtime") && c.personal_care_staff === 2);
  const personal = care === "morning" || care === "bedtime" || care === "pad_change";
  const task = newTask(world, "care", {
    label: extra.fullLabel ?? `${extra.label ?? (extra.meal ? extra.meal[0]!.toUpperCase() + extra.meal.slice(1) : CARE_LABEL[care])} for ${firstName(resident)}`,
    residentId: resident.id,
    staffNeeded: twoPerson ? 2 : 1,
    femaleOnly: personal && c.female_carers_only,
    // Post-fall observations come before routine care.
    priority: care === "check" && resident.resident!.postFallUntil > world.t ? 95 : PRIORITY[care],
    deadlineT: extra.dueT ?? null,
    data: { care, meal: extra.meal ?? null, to: extra.to ?? null, toast: extra.toast ? 1 : 0, first: extra.first ? 1 : 0 },
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
    // Their own en-suite, wherever they are (the Lounge has no WC of its own).
    data: { wc: `${res.data.room.split(".")[0]}.WC`, returnToBed: res.inBed ? 1 : 0, returnTo: res.inBed ? `${res.data.room}.Side` : (resident.atPoint ?? chairFor(resident)) },
  });
  res.busyTaskId = task.id;
  resident.task = task.label;
  return task;
}

/** A resident who walks alone takes themselves somewhere (to or from the Lounge). */
export function createSelfMove(world: World, resident: Person, to: string, label: string): Task {
  const res = resident.resident!;
  const task = newTask(world, "self_move", { label, residentId: resident.id, status: "active", startedT: world.t, data: { to } });
  res.busyTaskId = task.id;
  resident.task = task.label;
  return task;
}

/** A carer looks in on the Lounge (the lounge_supervision service target, docs/05). */
export function createLoungeCheck(world: World, dueT: number): Task {
  const task = newTask(world, "lounge_check", { label: "Look in on the Lounge", priority: PRIORITY.lounge_check, deadlineT: dueT, data: {} });
  emit(world, "task.created", [], { taskId: task.id, kind: "lounge_check", residentId: null, dueT });
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

/** The lone night carer's break (docs/05 "Night break"). */
export const NIGHT_BREAK_MINS = 25;

/**
 * Every break is in the staff room. The lone night carer's is shorter, taken while the floating
 * night carer covers the wing, and he can be called back from it for two-person or urgent work.
 */
function createBreak(world: World, night: boolean): Task {
  const point = STAFF_ROOM_SEATS[STAFF_ROOM_SEATS.length - 1]!;
  return newTask(world, "break", { label: "Break", data: { remainingMins: night ? NIGHT_BREAK_MINS : 30, point, interruptible: night ? 1 : 0, night: night ? 1 : 0, resumed: 0 } });
}

/** The lone night carer's break is on (active, or paused while he's called back). */
export function nightBreakOn(world: World): boolean {
  for (const t of world.tasks.values()) if (t.kind === "break" && t.data.night === 1) return true;
  return false;
}

/** On a planned round, the lone night carer's break is due and not yet taken: the floating carer waits for it. */
export function nightBreakWaiting(world: World): boolean {
  if (!world.float.planned) return false;
  for (const id of world.order) {
    const p = world.people.get(id)!;
    const s = p.staff;
    if (s?.shift?.shift === "night" && isCareStaff(p) && s.duty === "on_shift" && !s.breakTaken && s.breakDueT !== null && world.t >= s.breakDueT) return true;
  }
  return false;
}

/**
 * The lone night carer may start his break: the floating carer is here on a planned round and
 * covering the floor, and the round's two-person work (Dennis's turn, Raj's repositioning) is done.
 */
function nightBreakCovered(world: World, p: Person): boolean {
  const f = world.float;
  const lorna = world.people.get(world.data.rota.night_float.id)!;
  if (f.status !== "on_site" || !f.planned || lorna.staff!.duty !== "on_shift" || !onFloor(world, lorna)) return false;
  for (const t of world.tasks.values()) if (t.staffNeeded >= 2) return false;
  return coveredWithout(world, p);
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
    if (task.kind === "self_toilet" || task.kind === "self_move") resident.task = null;
  }
  if (task.kind !== "self_toilet" && task.kind !== "self_move" && task.kind !== "break" && task.kind !== "idle") {
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
  if (task.kind === "fall") {
    // Nobody should be pulled from a fall (falls.ts criticalWork). If it happens anyway, the fall
    // keeps its resident and waits, unstaffed, for the next person free (falls.ts staffFalls).
    if (task.assigned.length === 0) {
      task.status = "open";
      task.bt = newBtState();
    }
    return;
  }
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
    task.data.reservedBy = null;
    if (task.residentId && (task.kind === "assist" || task.kind === "care")) {
      world.people.get(task.residentId)!.resident!.busyTaskId = task.id;
      emit(world, "task.assigned", [...task.assigned, task.residentId], { taskId: task.id, kind: task.kind, staffIds: [...task.assigned] });
    }
  }
}

/** Covering the floor for a handover that hasn't finished (still working, even past shift end). */
export function coveringHandover(world: World, p: Person): boolean {
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

/** Can be called away for a request about to go over its limit: on a medication round. */
function interruptibleForUrgent(world: World, p: Person): boolean {
  const task = p.staff?.taskId ? world.tasks.get(p.staff.taskId) : undefined;
  if (!task || p.staff!.duty !== "on_shift") return false;
  return task.kind === "med_round";
}

/**
 * Short work (a few minutes) that someone who has reserved a two-person task may still do while
 * waiting for a partner (docs/04 "Two-person tasks").
 */
function isShort(task: Task): boolean {
  if (task.kind === "let_in" || task.kind === "lounge_check") return true;
  if (task.kind === "care") return ["tea", "check", "comfort", "escort"].includes(String(task.data.care));
  return task.kind === "assist" && task.staffNeeded === 1 && (task.need === "thirst" || task.need === "hunger" || task.need === "social");
}

const MORNING_ROUND = { noNurseFrom: clockToSeconds("07:45"), at: clockToSeconds("08:00"), until: clockToSeconds("12:00") };

/** From 07:45 until the 08:00 medication round is done, the day nurse doesn't start any resident care. */
export function morningRoundPending(world: World): boolean {
  const tod = timeOfDay(world.t);
  if (tod < MORNING_ROUND.noNurseFrom || tod >= MORNING_ROUND.until) return false;
  if (tod < MORNING_ROUND.at) return true;
  for (const t of world.tasks.values()) if (t.kind === "med_round" && t.data.round === "08:00") return true;
  return false;
}

/**
 * Rough minutes until a resident's morning care starts: the care time of everyone queued ahead
 * of them (older morning-care tasks, and any under way), shared between the carers available.
 */
export function morningCareWaitMins(world: World, residentId: string): number {
  const all = [...world.tasks.values()].filter((t) => t.kind === "care" && t.data.care === "morning");
  const mine = all.find((t) => t.residentId === residentId);
  if (!mine || mine.status !== "open") return 0;
  let work = 0;
  for (const t of all) {
    if (t === mine || (t.status === "open" && (t.createdT > mine.createdT || (t.createdT === mine.createdT && t.id > mine.id)))) continue;
    const care = world.people.get(t.residentId!)!.resident!.data.care;
    const mins = t.status === "open" ? care.personal_care_mins : Math.max(0, care.personal_care_mins - (world.t - (t.startedT ?? world.t)) / 60);
    work += mins * t.staffNeeded;
  }
  const medsPending = morningRoundPending(world);
  const carers = world.order
    .map((id) => world.people.get(id)!)
    .filter((q) => isCareStaff(q) && q.onMap && q.staff!.duty === "on_shift" && !onBreak(world, q) && !(medsPending && isNurse(q))).length;
  return work / Math.max(1, carers);
}


/** How long a request waits to be met on the same visit as care or a meal that's due (docs/04). */
const ONE_VISIT_MINS = 15;
const MEALS_START = [clockToSeconds("07:30"), clockToSeconds("12:15"), clockToSeconds("17:30")];

/**
 * A request that scheduled care already on its way will meet: open or active care for the same
 * resident that meets it, or (for hunger and thirst) a meal due within 15 minutes. It isn't
 * matched separately for up to 15 minutes, so snack and care happen in one visit.
 */
function deferToCare(world: World, request: Task): boolean {
  if (world.t - request.createdT >= ONE_VISIT_MINS * 60) return false;
  if (request.deadlineT !== null && request.deadlineT - world.t < 10 * 60) return false;
  for (const t of world.tasks.values()) {
    if (t.kind === "care" && t.residentId === request.residentId && t.data.effectsDone !== 1 && meets(t, request.need!) && t.staffNeeded >= request.staffNeeded) return true;
  }
  if (request.need === "hunger" || request.need === "thirst") {
    const tod = timeOfDay(world.t);
    if (MEALS_START.some((from) => from > tod && from - tod <= ONE_VISIT_MINS * 60)) return true;
  }
  return false;
}

/**
 * A turn due within this long is pressing: it's reserved for whoever is free, who (with its only
 * possible partner) then keeps to short work, so nobody starts a 20-minute wash just before it.
 */
const PRESSING_TURN_MINS = 25;
/** Before the pressing-turns tuning rule (docs/12): 15 minutes. */
const pressingMins = (world: World) => (tuned(world, "pressing_turns") ? PRESSING_TURN_MINS : 15);

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
    if (isTurn(t) && t.deadlineT !== null) dues.push(t.deadlineT);
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


/** Care with residents: scheduled care, help requests and drinks rounds (not a Lounge look-in or the door). */
function isResidentCare(task: Task): boolean {
  return task.kind === "care" || task.kind === "assist" || task.kind === "round";
}

/** In the floating carer's hours (turns due 21:30 to 08:00 are hers and the night carer's). */
function floatCovers(due: number): boolean {
  const tod = timeOfDay(due);
  return tod >= FLOAT_TURNS.from || tod < FLOAT_TURNS.until;
}

/** Breakfast offered before morning care (they'd been waiting over 30 minutes): care waits until they've eaten. */
function breakfastFirst(world: World, residentId: string): boolean {
  if (!tuned(world, "breakfast_first")) return false;
  for (const t of world.tasks.values()) if (t.residentId === residentId && t.kind === "care" && t.data.meal === "breakfast" && t.data.first === 1) return true;
  return false;
}

/** An open female-only task is waiting and `p` is the only woman on duty who could do it. */
function onlyOneFor(world: World, p: Person, open: Task[]): boolean {
  if (p.gender !== "female" || !open.some((t) => t.femaleOnly)) return false;
  return !world.order.some((id) => {
    const q = world.people.get(id)!;
    return q.id !== p.id && q.gender === "female" && isCareStaff(q) && q.staff!.duty === "on_shift" && q.onMap;
  });
}

/** Female-only personal care is waiting or still to come this morning (Peggy's and Kamala's washes and toilet). */
function femaleOnlyPending(world: World): boolean {
  for (const t of world.tasks.values()) if (t.femaleOnly && t.status === "open") return true;
  const tod = timeOfDay(world.t);
  if (tod < clockToSeconds("06:00") || tod >= clockToSeconds("10:00")) return false;
  return world.order.some((id) => {
    const r = world.people.get(id)!.resident;
    return !!r && r.data.care.female_carers_only && !r.morningDone && world.people.get(id)!.onMap;
  });
}

function onlyWomanOnShift(world: World, p: Person): boolean {
  return !world.order.some((id) => {
    const q = world.people.get(id)!;
    return q.id !== p.id && q.gender === "female" && isCareStaff(q) && q.onMap && q.staff!.duty === "on_shift";
  });
}

/** A turn (repositioning). */
export function isTurn(task: Task): boolean {
  return task.kind === "care" && task.data.care === "reposition";
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
    const hard = task.request || task.kind === "lounge_check" || isTurn(task) || (task.kind === "care" && (task.data.care === "check" || (tuned(world, "tea_deadline") && task.data.care === "tea")));
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
  // Morning care and breakfast rise faster the longer they've been awake, so both go roughly in
  // wake order and a late riser isn't left behind every breakfast (or an early riser's breakfast behind every wash).
  const woke = resident?.resident?.wokeT;
  const morningWork = task.kind === "care" && (task.data.care === "morning" || (tuned(world, "breakfast_boost") && task.data.meal === "breakfast"));
  if (morningWork && woke !== null && woke !== undefined) score += Math.min(90, 1.5 * ((world.t - woke) / 60));
  // Women are the scarce staff for female-only care (Peggy, Kamala): it comes first for them, and
  // the only woman on shift is kept off two-person work others could pair for while such care is pending.
  if (task.femaleOnly && tuned(world, "female_only_bonus")) score += 25;
  else if (tuned(world, "only_woman_two_person") && task.staffNeeded === 2 && p.gender === "female" && femaleOnlyPending(world) && onlyWomanOnShift(world, p)) score -= 30;
  if (isNurse(p)) score -= 25; // nurses help, but carers go first
  if (p.staff!.taskId) score -= 10; // on an interruptible break or a medication round
  return score;
}

export function decideStaff(world: World): void {
  const staff = world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap && p.staff && onDuty(p));
  const tasks = [...world.tasks.values()];

  // 1. Handovers and briefings claim their members as soon as they are free, including outgoing
  //    staff whose shift has technically ended (they still owe the handover).
  const briefingHold = new Set<string>();
  const memberFree = (p: Person) => isCareStaff(p) && idleOrFree(world, p) && (p.staff!.duty === "on_shift" || p.staff!.duty === "staying");
  for (const task of tasks.filter((t) => t.members && t.status !== "done")) {
    if (task.kind === "briefing") {
      // Starts when both are free at once (neither stands waiting for the other in the morning
      // rush); after an hour it's skipped and the written handover notes stand in.
      if (task.assigned.length < 2 && world.t - task.createdT > 60 * 60) {
        resetTask(world, task, "briefing skipped: handover notes instead");
        world.tasks.delete(task.id);
        continue;
      }
      // Whoever is free first keeps to short work (up to 10 minutes) until the other is free too,
      // rather than standing waiting for them in the morning rush (it matters most when the shift
      // is short: tuning review, docs/12). Without the rule, each joins as soon as they're free.
      if (!tuned(world, "briefing_hold")) {
        for (const p of task.members!.map((id) => world.people.get(id)!)) if (p.onMap && memberFree(p) && !task.assigned.includes(p.id)) assign(world, task, [p]);
        continue;
      }
      const both = task.members!.map((id) => world.people.get(id)!);
      const free = both.filter((p) => p.onMap && memberFree(p));
      if (task.assigned.length === 0 && free.length === 2) {
        task.data.heldBy = null;
        assign(world, task, both);
      } else if (free.length === 1 && !task.data.heldBy) Object.assign(task.data, { heldBy: free[0]!.id, heldSince: world.t });
      if (task.data.heldBy && world.t - Number(task.data.heldSince) > 10 * 60) task.data.heldBy = null;
      if (task.data.heldBy) briefingHold.add(String(task.data.heldBy));
      continue;
    }
    // A medication round whose giver is off the wing or with a fallen resident goes to another
    // meds-trained member of staff who is free (e.g. the on-call RN over for a fall at 21:00).
    if (task.kind === "med_round" && task.assigned.length === 0) {
      const giver = world.people.get(task.members![0]!);
      const giverTask = giver?.staff?.taskId ? world.tasks.get(giver.staff.taskId) : undefined;
      if (!giver || !onDuty(giver) || giverTask?.kind === "fall") {
        const other = staff.find((p) => p.id !== giver?.id && p.staff!.duty === "on_shift" && memberFree(p) && p.staff!.competencies.includes("meds_trained"));
        if (other) {
          task.members = [other.id];
          emit(world, "task.assigned", [other.id], { taskId: task.id, kind: task.kind, staffIds: [other.id] });
        }
      }
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

  // Reservations on two-person tasks (docs/04 "Two-person tasks"): whoever reserved one keeps
  // doing short work until a partner is free, then both go. A reservation lapses if the
  // reserver goes off shift.
  const open = tasks.filter((t) => (t.kind === "assist" || t.kind === "care" || t.kind === "round" || t.kind === "let_in" || t.kind === "lounge_check") && t.status === "open").sort((a, b) => a.id.localeCompare(b.id));
  const reserverOf = new Map<string, Task>();
  for (const t of open) {
    const by = t.data.reservedBy ? world.people.get(String(t.data.reservedBy)) : undefined;
    const doing = by?.staff?.taskId ? world.tasks.get(by.staff.taskId) : undefined;
    // Lapses if they've gone off shift or are doing anything longer than short work (a handover, a round).
    const barred = !!by && isNurse(by) && morningRoundPending(world) && isResidentCare(t);
    if (!by || barred || by.staff?.duty !== "on_shift" || !by.onMap || (doing && doing.kind !== "idle" && !isShort(doing))) t.data.reservedBy = null;
    else reserverOf.set(by.id, t);
  }


  // 2. Resume a paused break, or start a due one if the floor stays covered.
  for (const p of staff) {
    const s = p.staff!;
    // Office and reception staff take lunch too; they don't cover the floor, so no cover check.
    if (s.duty !== "on_shift" || !idleOrFree(world, p) || !s.shift?.started) continue;
    // A handover's floor cover stays on the floor until it's done: no break starts or resumes.
    if (isCareStaff(p) && coveringHandover(world, p)) continue;
    if (s.pausedBreakId) {
      const paused = world.tasks.get(s.pausedBreakId)!;
      // A day break cut short (for a fall) resumes only once someone else covers the floor, as
      // when it started; the lone night carer's break counts as on the floor, so it just resumes.
      if (paused.data.night !== 1 && isCareStaff(p) && !coveredWithout(world, p, true, undefined, true)) continue;
      s.pausedBreakId = null;
      paused.status = "open";
      paused.assigned = [];
      assign(world, paused, [p]);
      continue;
    }
    if (s.breakTaken || s.breakDueT === null || world.t < s.breakDueT) continue;
    if (reserverOf.has(p.id)) continue; // a partner is on their way
    const sole = s.shift?.shift === "night";
    // The lone night carer's break waits for the floating carer's round, after its turns.
    if (sole && isCareStaff(p) && !nightBreakCovered(world, p)) continue;
    // Day staff wait for a two-person turn that's nearly due.
    if (isCareStaff(p) && !sole && twoPersonTurnSoon(world, p)) continue;
    // Not while there's waiting work only they can do (female-only care, and they're the only woman on).
    if (tuned(world, "break_waits_only_woman") && isCareStaff(p) && onlyOneFor(world, p, open)) continue;
    if (!isCareStaff(p) || sole || coveredWithout(world, p, true, undefined, true)) assign(world, createBreak(world, sole && isCareStaff(p)), [p]);
  }

  // 3. Work: repeatedly take the best (task, staff) match.
  const night = isNight(world.t);
  const medsPending = morningRoundPending(world);
  // The only people who could do a pressing turn keep to short work until it's done: the only
  // possible partner of whoever reserved it, and (not yet reserved) the only people free for it,
  // so nobody starts a 20-minute wash that would make it late.
  const pressingTurn = (t: Task) => isTurn(t) && t.deadlineT !== null && (t.deadlineT - world.t <= pressingMins(world) * 60 || world.float.status !== "off");
  const solePartner = (): Map<string, Task> => {
    const out = new Map<string, Task>();
    if (!tuned(world, "sole_partner")) return out;
    for (const [by, t] of reserverOf) {
      if (!pressingTurn(t)) continue;
      const partners = staff.filter((q) => q.id !== by && isFree(world, q, true) && !reserverOf.has(q.id) && (!t.femaleOnly || q.gender === "female"));
      if (partners.length === 1) out.set(partners[0]!.id, t);
    }
    return out;
  };
  // Two-person turns falling due soon (reserved, open, or not created yet: the next turn of anyone
  // in bed who is turned), for looking ahead before starting long care.
  const turnDues: number[] = [];
  if (tuned(world, "turn_team")) {
    for (const t of open) if (isTurn(t) && t.deadlineT !== null) turnDues.push(t.deadlineT);
    for (const id of world.order) {
      const q = world.people.get(id)!;
      const res = q.resident;
      if (!res || !q.onMap || !res.inBed || [...open].some((t) => isTurn(t) && t.residentId === id)) continue;
      const care = res.data.care;
      const every = care.bed_bound ? (isNight(res.lastTurnedT) ? care.reposition_interval_mins.night : care.reposition_interval_mins.day) : isNight(world.t) ? care.reposition_interval_mins.night : null;
      if (every) turnDues.push(res.lastTurnedT + every * 60);
    }
  }
  /**
   * `p` shouldn't start long care that would still be going when a two-person turn falls due, if
   * they're needed for it: fewer than two others could do it (the floating carer counts for turns
   * in her hours). Short work, and anyone's request for help, is fine.
   */
  const neededForTurn = (p: Person, task: Task): boolean => {
    // Scheduled care only: a resident asking for help (the toilet) isn't kept waiting for a turn.
    if (turnDues.length === 0 || isShort(task) || isTurn(task) || task.request) return false;
    const r = task.residentId ? world.people.get(task.residentId)?.resident : undefined;
    // The care, and a few minutes to get to the turn afterwards.
    const until = world.t + ((r?.data.care.personal_care_mins ?? 15) + 5) * 60;
    const due = turnDues.filter((d) => d > world.t && d <= until).sort((a, b) => a - b)[0];
    if (due === undefined) return false;
    const floatId = world.data.rota.night_float.id;
    let others = staff.filter((q) => q.id !== p.id && isCareStaff(q) && q.staff!.duty === "on_shift" && !onBreak(world, q)).length;
    if (p.id !== floatId && !staff.some((q) => q.id === floatId) && floatCovers(due)) others += 1;
    return others < 2;
  };
  // Not yet reserved: the only people free for a pressing turn keep to short work or pressing turns.
  const turnTeam = (): Set<string> => {
    const out = new Set<string>();
    if (!tuned(world, "turn_team")) return out;
    const reserved = new Set(reserverOf.values());
    for (const t of open) {
      if (t.status !== "open" || reserved.has(t) || !pressingTurn(t)) continue;
      const team = staff.filter((q) => isFree(world, q, true) && !reserverOf.has(q.id) && (!t.femaleOnly || q.gender === "female"));
      if (team.length === t.staffNeeded) for (const q of team) out.add(q.id);
    }
    return out;
  };
  for (;;) {
    const partnerOf = solePartner();
    const teamFor = turnTeam();
    let best: { task: Task; people: Person[]; score: number } | null = null;
    let bestReserve: { task: Task; person: Person; score: number; pressing: boolean } | null = null;
    for (const task of open) {
      if (task.status !== "open" || task.data.absorbedBy) continue;
      const resident = task.residentId ? world.people.get(task.residentId)!.resident! : null;
      // One thing at a time: a resident busy with other care can't start this yet (though a turn
      // can still be reserved while someone does a quick check on them).
      const busyWith = resident?.busyTaskId && resident.busyTaskId !== task.id ? world.tasks.get(resident.busyTaskId) : undefined;
      if (busyWith) continue;
      if (task.request && deferToCare(world, task)) continue; // met on the same visit as care that's due
      if (task.data.care === "morning" && breakfastFirst(world, task.residentId!)) continue; // they eat first
      const needed = task.staffNeeded;
      // Requests, checks, turns and Lounge look-ins about to go over may interrupt a medication round.
      const targetTask = task.request || task.kind === "lounge_check" || isTurn(task) || (task.kind === "care" && task.data.care === "check");
      const urgent = targetTask && task.deadlineT !== null && task.deadlineT - world.t <= INTERRUPT_MEDS_WITHIN_MINS * 60;
      const nurseOnMeds = medsPending && isResidentCare(task);
      const eligible = (p: Person) =>
        (!task.femaleOnly || p.gender === "female") &&
        !(nurseOnMeds && isNurse(p)) &&
        // Someone holding a reservation (or its only partner) only takes short work, or the reserved task itself.
        (!reserverOf.has(p.id) || reserverOf.get(p.id) === task || isShort(task)) &&
        (!partnerOf.has(p.id) || partnerOf.get(p.id) === task || isShort(task)) &&
        (!teamFor.has(p.id) || isShort(task) || pressingTurn(task)) &&
        !neededForTurn(p, task) &&
        (!briefingHold.has(p.id) || isShort(task));
      // Someone whose shift has ended stays to do what only they can (e.g. the last woman on the wing).
      const onlyThem = (p: Person) => task.request && p.staff!.duty === "staying" && isCareStaff(p) && !p.staff!.taskId && !coverableOnSite(world, task);
      // The lone night carer is called back from his break only for two-person work, anything
      // urgent, or a fall; the floating carer covers the rest meanwhile.
      const nightBreakCall = needed >= 2 || world.fallLog.some((f) => f.endT === null) || (task.deadlineT !== null && task.deadlineT - world.t <= INTERRUPT_MEDS_WITHIN_MINS * 60);
      const onNightBreak = (p: Person) => world.tasks.get(p.staff!.taskId ?? "")?.data.night === 1;
      let pool = staff.filter((p) => eligible(p) && ((isFree(world, p, true) && (!onNightBreak(p) || nightBreakCall)) || onlyThem(p)));
      if (urgent && pool.length < needed) pool = [...pool, ...staff.filter((p) => eligible(p) && isCareStaff(p) && interruptibleForUrgent(world, p))];
      // A look-in on the Lounge about to go over its limit calls someone back from a day break (it resumes afterwards).
      if (tuned(world, "lounge_break_recall") && urgent && task.kind === "lounge_check" && pool.length < needed) {
        pool = [...pool, ...staff.filter((p) => eligible(p) && isCareStaff(p) && p.staff!.duty === "on_shift" && onBreak(world, p) && !pool.includes(p))];
      }
      const candidates = pool
        .map((p) => ({ p, score: taskScore(world, p, task) }))
        .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
      let chosen: typeof candidates;
      const reserver = task.data.reservedBy ? String(task.data.reservedBy) : null;
      const others = candidates.filter((c) => c.p.id !== reserver);
      if (reserver && others.length < 2) {
        // Reserved: the reserver (once free of their short task) plus the best partner.
        const own = candidates.find((c) => c.p.id === reserver);
        if (!own || others.length === 0) continue;
        chosen = [own, others[0]!];
      } else if (reserver) {
        // The reserver with a partner, or (the reserver busy for a moment) two others.
        const own = candidates.find((c) => c.p.id === reserver);
        chosen = own ? [own, others[0]!] : others.slice(0, 2);
      } else {
        // Reserve a waiting two-person task rather than let it starve: by day after 5 minutes,
        // and at any time for a turn about to go over its interval. One reservation at a time.
        // Pressing: a turn about to go over its interval, or one the floating carer has come in for.
        const pressing = isTurn(task) && task.deadlineT !== null && (task.deadlineT - world.t <= pressingMins(world) * 60 || world.float.status !== "off");
        const free = candidates.length === 1 && isFree(world, candidates[0]!.p, false);
        if (needed === 2 && free && reserverOf.size === 0 && ((!night && world.t - task.createdT >= 5 * 60) || pressing)) {
          if (!bestReserve || candidates[0]!.score > bestReserve.score) bestReserve = { task, person: candidates[0]!.p, score: candidates[0]!.score, pressing };
          continue;
        }
        if (candidates.length < needed) continue;
        chosen = candidates.slice(0, needed);
      }

      const score = chosen.reduce((sum, c) => sum + c.score, 0) / chosen.length;
      if (!best || score > best.score) best = { task, people: chosen.map((c) => c.p), score };
    }
    if (bestReserve && (!best || (tuned(world, "pressing_first") && bestReserve.pressing))) {
      // The most pressing two-person task is reserved for its one free candidate: before anything
      // else if it's a turn about to fall due (so they don't start something long), otherwise
      // when nothing else can start.
      bestReserve.task.data.reservedBy = bestReserve.person.id;
      reserverOf.set(bestReserve.person.id, bestReserve.task);
      continue;
    }
    if (!best) break;
    const reserved = best.task.data.reservedBy;
    assign(world, best.task, best.people);
    if (reserved) reserverOf.delete(String(reserved));
  }

  // 4. Anyone still free takes up a low-priority activity. The handover's floor cover only does
  //    checks on the floor (never anything in the staff room).
  for (const p of staff) {
    const floating = p.id === world.data.rota.night_float.id;
    if (p.staff!.duty !== "on_shift" || p.staff!.taskId || !(p.staff!.shift?.started || floating)) continue;
    startIdleActivity(world, p, coveringHandover(world, p));
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

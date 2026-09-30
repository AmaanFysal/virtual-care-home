// Falls (docs/05 "Fall response", spec decision 8). In Phase 1 falls only happen when a user
// injects one. Nobody is ever left on the floor: the nearest carer whose work can wait comes
// (never one attending another fall, or in the middle of a two-person transfer or walking a
// resident); if nobody can, help is asked for and the next person free comes (docs/05 "Several
// falls at once"). Nobody moves a fallen resident until they have been assessed:
// - Day (an RN on the wing): the nearest carer finds them and stays; the RN comes (pausing a
//   med round if need be) and assesses for 10 minutes.
// - Otherwise (night, or evening once the RN is on call): the carer phones the on-call RN; the
//   call (3 to 5 minutes) is the assessment.
// Minor: two staff lift with the hoist (at night the floating carer comes to help), back to bed
// or chair, then checks every 30 minutes for 4 hours. Serious: 999; a carer stays with them;
// paramedics arrive after 30 to 90 minutes and take them to hospital; a CQC Regulation 18
// notification is flagged. If the RN isn't on the wing (night, or evening on call), the on-call RN
// comes over from the main building (about 10 minutes) and works on the wing until the
// paramedics have gone: an extra pair of hands while the carer stays with the resident. The family is phoned and an incident recorded after every fall.
// Not a clinical tool: the procedure is plausible, not authoritative.

import type { FallSeverity, NamedPoint, Source } from "@vch/shared-types";
import { act, cond, leaf, sel, seq, until, type BtNode } from "./bt.js";
import { emit } from "./emit.js";
import { comeIn, floatPerson } from "./float.js";
import { isNight } from "./nightcover.js";
import { isCareStaff, isNurse, type Person, type Task, type World } from "./state.js";
import { newBtState } from "./bt.js";
import { addPerson, staffPerson } from "./rota.js";
import { pullOff, resetTask } from "./tasks.js";
import { chairFor, goTo, markChecked, setBadges, waitMins, type Ctx } from "./trees.js";
import { cellAt, cellCentre } from "./world/grid.js";
import { getIntoBed, placeAt, releaseStand, walkTo } from "./world/movement.js";
import { leaveForHospital } from "./health.js";
import { formatSimTime } from "@vch/shared-types";

export const PARAMEDICS_ID = "ext_paramedics";
export const ON_CALL_RN_ID = "ext_oncall_rn";
export const MAIN_CARER_ID = "ext_main_carer";
/** Chance a carer can be spared from the main building when asked; if not, ask again after RETRY. */
const MAIN_CARER_AVAILABLE = 0.8;
const MAIN_CARER_RETRY_MINS = 30;
/** A resident left waiting on the floor is looked in on at least this often (from 4 minutes, so it's never over 5). */
const WAITING_CHECK_MINS = 5;
const WAITING_CHECK_FROM_MINS = 4;
const RN_ASSESS_MINS = 10;
const LIFT_MINS = 5;
const PARAMEDIC_HANDOVER_MINS = 10;
const POST_FALL_OBS_HOURS = 4;
/** While waiting with someone, the carer's presence counts as a check this often. */
const STAY_CHECK_MINS = 15;

const first = (p: Person) => p.name.split(" ")[0]!;

function onWing(p: Person): boolean {
  return p.onMap && (p.staff?.duty === "on_shift" || p.staff?.duty === "staying");
}

function rnOnWing(world: World): Person | null {
  return world.order.map((id) => world.people.get(id)!).find((p) => isNurse(p) && onWing(p)) ?? null;
}

/**
 * Work nobody is pulled from, even for a fall: attending another fall, a two-person task being
 * performed (a transfer, hoist or turn), or walking a resident who is on their feet.
 */
export function criticalWork(world: World, task: Task): boolean {
  if (task.kind === "fall") return true;
  if (task.staffNeeded >= 2 && task.data.phase === "performing") return true;
  if (task.status !== "active" || task.startedT === null) return false;
  const walking = (task.kind === "care" && task.data.care === "escort") || (task.kind === "assist" && task.data.method === "escort");
  // Personal care with the resident on their feet (getting up to the chair, going to bed) can't be left either.
  const resident = task.residentId ? world.people.get(task.residentId) : undefined;
  const onFeet = !!resident && (!!resident.move || resident.posture === "standing" || resident.posture === "walking");
  return walking || (onFeet && (task.kind === "care" || task.kind === "assist"));
}

/** Personal care under way with a resident lying or seated: a carer called to a fall first makes them safe. */
function personalCareUnderWay(task: Task): boolean {
  if (task.status !== "active" || task.startedT === null) return false;
  if (task.kind === "care") return ["morning", "bedtime", "pad_change"].includes(String(task.data.care));
  return task.kind === "assist" && task.need === "toileting";
}

/** Can come to a fall now: care staff on the wing whose work can wait (meals, drinks, a medication round, a wash, idling, a break). */
function available(world: World, p: Person): boolean {
  if (!isCareStaff(p) || !onWing(p)) return false;
  const task = p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined;
  return !task || !criticalWork(world, task);
}

/** Care staff who could come, nearest first, preferring people not in a handover or briefing. */
function nearestAvailable(world: World, to: Person, exclude: string[]): Person[] {
  const inMeeting = (p: Person) => {
    const task = p.staff?.taskId ? world.tasks.get(p.staff.taskId) : undefined;
    return task?.kind === "handover" || task?.kind === "briefing";
  };
  return world.order
    .map((id) => world.people.get(id)!)
    .filter((p) => available(world, p) && !exclude.includes(p.id))
    .sort((a, b) => Number(inMeeting(a)) - Number(inMeeting(b)) || Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y) || a.id.localeCompare(b.id));
}

function join(world: World, task: Task, p: Person): void {
  const doing = p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined;
  if (doing && personalCareUnderWay(doing)) {
    // Covered for dignity and left lying in bed or seated; the care goes back on the queue.
    const r = world.people.get(doing.residentId!)!;
    const care = doing.kind === "care" ? String(doing.data.care) : "toileting";
    const fallen = world.people.get(task.residentId!)!;
    emit(world, "care.made_safe", [r.id, p.id], { residentId: r.id, staffId: p.id, care, position: r.resident!.inBed ? "lying in bed" : "seated", covered: true, reason: `called to ${first(fallen)}'s fall` });
  }
  pullOff(world, p, "called to a fall");
  p.staff!.taskId = task.id;
  task.assigned.push(p.id);
  task.status = "active";
  task.data.helpRequestedT = null;
  task.data.leftT = null;
  task.data.checkerId = null;
}

/** A fall nobody is with or on the way to. */
function unattended(world: World, except?: Task): boolean {
  for (const t of world.tasks.values()) if (t.kind === "fall" && t !== except && t.assigned.length === 0) return true;
  return false;
}

/** The floating carer or the on-call RN is on the way. */
function helpOnTheWay(world: World): boolean {
  return world.float.status === "coming" || world.onCallRn.status === "coming";
}

/** What every care staff member on the wing is doing, for a fall nobody can come to yet. */
function whyNobody(world: World): string {
  const carers = world.order.map((id) => world.people.get(id)!).filter((p) => isCareStaff(p) && onWing(p));
  if (carers.length === 0) return "no care staff on the wing";
  const doing = carers.map((p) => {
    const task = p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined;
    if (task?.kind === "fall") return `${first(p)} with ${first(world.people.get(task.residentId!)!)} (fall)`;
    return `${first(p)}: ${task ? task.label : "free"}`;
  });
  const lone = isNight(world.t) && carers.filter((p) => p.kind === "staff" || p.kind === "agency").length === 1;
  return `${lone ? "lone night carer with another fall" : "no one free"} (${doing.join("; ")})`;
}

/**
 * Nobody can come to this fall now: ask for help once. At night the floating carer is called out,
 * or if she's already here the on-call RN comes over; otherwise the next person free comes
 * (`staffFalls`). The fall counts as attended to by that request (the `fall_unattended` invariant).
 */
function requestHelp(world: World, task: Task, reason = whyNobody(world)): void {
  if (task.data.helpRequestedT !== null && task.data.helpRequestedT !== undefined) return;
  task.data.helpRequestedT = world.t;
  const r = world.people.get(task.residentId!)!;
  let called: "floating_carer" | "on_call_rn" | "on_the_way" | "next_free" = "next_free";
  if (isNight(world.t)) {
    if (world.float.status === "off") {
      world.metrics.floatCallouts += 1;
      emit(world, "second_carer.called", [floatPerson(world).id], { reason: "a fall with nobody free", residentIds: [r.id], outOfRound: true });
      comeIn(world, false, world.rng.falls.int(8, 12));
      called = "floating_carer";
    } else if (world.float.status === "coming") called = "on_the_way";
    else if (world.onCallRn.status === "off") {
      world.onCallRn = { status: "coming", arriveT: world.t + world.rng.falls.int(8, 12) * 60, residentId: r.id };
      emit(world, "on_call_rn.called", [r.id], { residentId: r.id, reason: "a fall with nobody free" });
      called = "on_call_rn";
    } else if (world.onCallRn.status === "coming") called = "on_the_way";
  }
  task.data.helpCalled = called;
  task.data.helpReason = `${reason}; help: ${called.replace(/_/g, " ")} at ${formatSimTime(world.t).slice(-5)}`;
  emit(world, "fall.help_requested", [r.id], { residentId: r.id, reason, called });
}

/**
 * Every tick (and before each assignment pass): each fall nobody is with gets the nearest person
 * whose work can wait, ahead of any other work; otherwise help is asked for.
 */
export function staffFalls(world: World): void {
  for (const task of world.tasks.values()) {
    if (task.kind !== "fall" || task.assigned.length > 0) continue;
    const p = nearestAvailable(world, world.people.get(task.residentId!)!, [])[0];
    if (p) {
      join(world, task, p);
      continue;
    }
    // The help that was on its way has arrived and gone to another fall: ask the next in line.
    if (task.data.helpCalled === "on_the_way" && !helpOnTheWay(world)) task.data.helpRequestedT = null;
    requestHelp(world, task);
  }
  callMainBuilding(world);
  checkOnWaiting(world);
}

/** Every care staff member on the wing is with a fallen resident, and a fall still needs someone (to reach it, or to help lift). */
function allCommitted(world: World): boolean {
  const carers = world.order.map((id) => world.people.get(id)!).filter((p) => isCareStaff(p) && onWing(p));
  if (carers.length === 0 || carers.some((p) => world.tasks.get(p.staff!.taskId ?? "")?.kind !== "fall")) return false;
  return [...world.tasks.values()].some((t) => t.kind === "fall" && (t.assigned.length === 0 || t.data.waitingForLift === 1));
}

/** With everyone committed to falls, a carer from the main building is asked for (about 15 minutes, if one can be spared). */
function callMainBuilding(world: World): void {
  const m = world.mainCarer;
  if (m.status !== "off" || world.t < m.retryT || !allCommitted(world)) return;
  // She joins the world the first time she's asked for (like agency workers), so runs without
  // falls are unchanged (visitors' waiting-area seats depend on everyone's position in world.order).
  if (!world.people.has(MAIN_CARER_ID)) {
    const main = staffPerson({ id: MAIN_CARER_ID, name: "Main-building Carer", gender: "female", walk_speed_mps: 1.2, role: "care_assistant", competencies: ["moving_handling"] });
    main.kind = "external";
    main.staff!.role = "main_building_carer";
    addPerson(world, main);
  }
  const available = world.rng.falls.chance(MAIN_CARER_AVAILABLE);
  const reason = whyNobody(world);
  if (available) {
    m.status = "coming";
    m.arriveT = world.t + world.rng.falls.int(12, 18) * 60;
  } else m.retryT = world.t + MAIN_CARER_RETRY_MINS * 60;
  emit(world, "main_carer.called", [MAIN_CARER_ID], { reason, available, arriveT: available ? m.arriveT : null });
}

/**
 * A resident left waiting while their carer helps with another lift is looked in on at least
 * every 5 minutes: by a carer with another fallen resident who is only waiting for a lift (not
 * mid-lift), who steps across, checks and goes back.
 */
function checkOnWaiting(world: World): void {
  for (const task of world.tasks.values()) {
    if (task.kind !== "fall" || task.data.leftT === null || task.data.leftT === undefined || task.assigned.length > 0) continue;
    const r = world.people.get(task.residentId!)!;
    const spot = String(task.data.point);
    const checker = task.data.checkerId ? world.people.get(String(task.data.checkerId)) : undefined;
    if (checker) {
      const own = world.tasks.get(checker.staff!.taskId ?? "");
      if (checker.atPoint === spot && !checker.move) {
        const since = Math.round((world.t - Number(task.data.lastCheckT)) / 60);
        task.data.lastCheckT = world.t;
        task.data.checkerId = null;
        markChecked(world, r, [checker], false);
        emit(world, "fall.checked", [r.id, checker.id], { residentId: r.id, staffId: checker.id, sinceMins: since });
        if (own?.kind === "fall") walkTo(world, checker, String(own.data.point));
      } else if (checker.move?.destPointId !== spot || own?.kind !== "fall" || own.assigned.length > 1) task.data.checkerId = null; // needed for a lift after all
      continue;
    }
    if (world.t - Number(task.data.lastCheckT) < WAITING_CHECK_FROM_MINS * 60) continue;
    const candidates = [...world.tasks.values()]
      .filter((t) => t.kind === "fall" && t !== task && t.assigned.length === 1 && t.data.waitingForLift === 1)
      .map((t) => world.people.get(t.assigned[0]!)!)
      .filter((p) => !p.move)
      .sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y) || a.id.localeCompare(b.id));
    const who = candidates[0];
    if (!who) continue; // nobody can step across: reported as a missed check (fall_waiting_check)
    task.data.checkerId = who.id;
    walkTo(world, who, spot);
  }
}

/** Every tick: when each fallen resident was last left with nobody coming and no help asked for. */
export function watchFalls(world: World): void {
  for (const id of world.order) {
    const p = world.people.get(id)!;
    const fall = p.resident?.fall;
    if (!fall) continue;
    const task = world.tasks.get(fall.taskId);
    const covered = !!task && (task.assigned.some((s) => world.people.get(s)?.onMap) || (task.data.helpRequestedT !== null && task.data.helpRequestedT !== undefined));
    fall.uncoveredSinceT = covered ? null : (fall.uncoveredSinceT ?? world.t);
  }
}

/** Applies an `inject_fall` input. */
export function injectFall(world: World, residentId: string, severity: FallSeverity, source: Source): void {
  const r = world.people.get(residentId);
  const res = r?.resident;
  if (!r || !res || !r.onMap || res.fall) return;

  // Whatever they were doing stops.
  for (const task of [...world.tasks.values()]) {
    if (task.residentId !== r.id) continue;
    // Their own trip to the WC or the Lounge ends here (a reset one would never run again).
    if (task.kind === "self_toilet" || task.kind === "self_move") {
      world.tasks.delete(task.id);
      r.task = null;
    } else if (task.status === "active") resetTask(world, task, "resident fell");
  }
  res.busyTaskId = null;
  const wasInBed = res.inBed;

  // On the floor: beside the bed if they fell getting out, otherwise where they were.
  r.move = null;
  if (res.inBed) placeAt(world, r, `${res.data.room}.Side`);
  else {
    const here = cellCentre(world.grid, cellAt(world.grid, r.x, r.y));
    const spot: NamedPoint = { id: `Fall.${r.id}`, kind: "bedside", room: r.roomId!, x: here.x, y: here.y };
    world.points.set(spot.id, spot);
    placeAt(world, r, spot.id);
  }
  const point: NamedPoint = { id: `Fall.${r.id}`, kind: "bedside", room: r.roomId!, x: r.x, y: r.y };
  world.points.set(point.id, point);
  r.atPoint = point.id;
  r.posture = "on_floor";
  r.badges = ["alert"];
  res.inBed = false;
  res.asleep = false;
  world.shiftLog.get(r.id)!.falls += 1;
  world.fallLog.push({ residentId: r.id, severity, t: world.t, endT: null });
  emit(world, "resident.fell", [r.id], { residentId: r.id, severity, roomId: r.roomId ?? "" }, source);

  world.taskSeq += 1;
  const task = {
    id: `t${String(world.taskSeq).padStart(6, "0")}`,
    kind: "fall" as const,
    label: `Fall: ${r.name.split(" ")[0]}`,
    residentId: r.id,
    need: null,
    createdT: world.t,
    startedT: null,
    staffNeeded: 2 as const,
    femaleOnly: false,
    priority: 1000,
    request: false,
    deadlineT: null,
    members: null,
    assigned: [] as string[],
    status: "open" as Task["status"],
    bt: newBtState(),
    data: {
      severity,
      point: point.id,
      wasInBed: wasInBed ? 1 : 0,
      byPhone: rnOnWing(world) ? 0 : 1,
      phoneMins: world.rng.falls.int(3, 5),
      rn: null,
      lastStayCheck: 0,
      helpRequestedT: null,
      helpCalled: null,
      helpReason: null,
      leftT: null,
      lastCheckT: null,
      checkerId: null,
      leftReason: null,
      ambulance: 0,
      waitingForLift: 0,
    } as Record<string, number | string | string[] | null>,
  };
  world.tasks.set(task.id, task);
  res.busyTaskId = task.id;
  res.fall = { t: world.t, severity, assessed: false, taskId: task.id, uncoveredSinceT: null };
  const responder = nearestAvailable(world, r, [])[0];
  if (responder) join(world, task, responder);
  else requestHelp(world, task);
}

function point(c: Ctx): string {
  return String(c.task.data.point);
}

function responder(c: Ctx): Person {
  return c.staff[0]!;
}

function informFamily(c: Ctx, reason: string): void {
  const r = c.resident!;
  const nok = r.resident!.data.care.next_of_kin;
  emit(c.world, "family.informed", [r.id, responder(c).id], { residentId: r.id, visitorId: nok, staffId: responder(c).id, reason });
  emit(c.world, "incident.recorded", [r.id], { residentId: r.id, kind: "fall", severity: r.resident!.fall!.severity });
}

function assessed(c: Ctx, by: string): void {
  const res = c.resident!.resident!;
  res.fall!.assessed = true;
  const outcome = res.fall!.severity === "minor" ? "cleared_to_move" : "wait_for_ambulance";
  emit(c.world, "fall.assessed", [c.resident!.id, ...(by.startsWith("stf_") || by.startsWith("agy_") ? [by] : [])], { residentId: c.resident!.id, by, outcome });
}

function cleanUp(c: Ctx): void {
  const entry = c.world.fallLog.findLast((f) => f.residentId === c.resident!.id && f.endT === null);
  if (entry) entry.endT = c.world.t;
  c.world.points.delete(point(c));
  c.resident!.resident!.fall = null;
  c.resident!.badges = [];
}

/**
 * Someone else to help lift: by day the nearest other carer; at night the floating carer. Falls
 * nobody has reached come first. If everyone on the wing is with a fallen resident and no more
 * help can come, two of them lift one resident at a time (`pairUp`).
 */
const secondPairOfHands: BtNode<Ctx> = leaf("get a second pair of hands", (c) => {
  const { world, task } = c;
  const float = floatPerson(world);
  if (task.assigned.length < 2) {
    task.data.waitingForLift = 1;
    // The nearest other carer on the wing (the floating carer counts if she's here); at night,
    // with nobody else, call her out.
    const others = unattended(world) ? [] : nearestAvailable(world, c.resident!, task.assigned).filter((p) => p.staff!.duty === "on_shift" && !isNurse(p));
    const other = isNight(world.t) ? (others.find((p) => p.id === float.id) ?? others[0]) : others.find((p) => p.id !== float.id) ?? others[0];
    if (other) join(world, task, other);
    else if (world.float.status === "off") {
      world.metrics.floatCallouts += 1;
      emit(world, "second_carer.called", [float.id], { reason: "help to lift after a fall", residentIds: [c.resident!.id], outOfRound: true });
      comeIn(world, false, world.rng.falls.int(8, 12));
    } else if (!helpOnTheWay(world) && !unattended(world)) pairUp(c);
  }
  if (task.assigned.length < 2) return "running";
  task.data.waitingForLift = 0;
  let moving = false;
  for (const p of task.assigned.map((id) => world.people.get(id)!)) {
    if (p.atPoint !== point(c)) {
      if (p.move?.destPointId !== point(c)) walkTo(world, p, point(c));
      moving = true;
    }
  }
  return moving ? "running" : "success";
});

/**
 * Everyone on the wing is with a fallen resident, each waiting for a second pair of hands to lift,
 * and nobody else can come: the carer of the next fall comes to help lift this one (the earlier
 * fall first), then they go back together. The resident they leave, already assessed and made
 * comfortable, has help asked for, so the next person free comes (logged as `fall.help_requested`).
 */
function pairUp(c: Ctx): void {
  const { world, task } = c;
  // Only a resident who has been assessed as not injured (a minor fall waiting for a lift) is left.
  const later = [...world.tasks.values()].find(
    (t) => t.kind === "fall" && t.id > task.id && t.assigned.length === 1 && t.data.waitingForLift === 1 && t.data.severity === "minor" && world.people.get(t.residentId!)!.resident!.fall?.assessed,
  );
  if (!later) return;
  // Someone must be able to look in on whoever is left: a carer with another fallen resident who is
  // only waiting for a lift. If nobody can yet, wait while one soon will (still assessing their own
  // resident's minor fall) or the main-building carer is on her way. Only with neither do they pair
  // up anyway (two falls, two carers, nobody to spare): the missed look-ins are reported.
  const others = [...world.tasks.values()].filter((t) => t.kind === "fall" && t !== task && t !== later && t.assigned.length === 1);
  const lookers = others.filter((t) => t.data.waitingForLift === 1);
  const soon = others.filter((t) => t.data.severity === "minor" && !world.people.get(t.residentId!)!.resident!.fall?.assessed);
  if (lookers.length === 0 && (soon.length > 0 || world.mainCarer.status === "coming")) return;
  const helper = world.people.get(later.assigned[0]!)!;
  const left = world.people.get(later.residentId!)!;
  const reason = `${first(helper)} helping to lift ${first(c.resident!)}`;
  // Made comfortable first: a pillow and a blanket, and a look at them before going.
  markChecked(world, left, [helper], false);
  emit(world, "fall.made_comfortable", [left.id, helper.id], { residentId: left.id, staffId: helper.id, reason });
  later.assigned = [];
  later.status = "open";
  later.bt = newBtState();
  later.data.waitingForLift = 0;
  helper.staff!.taskId = null;
  requestHelp(world, later, reason);
  Object.assign(later.data, { leftT: world.t, lastCheckT: world.t, checkerId: null, leftReason: reason });
  join(world, task, helper);
}

/** Waits with the resident until the paramedics are with them. */
const waitForParamedics: BtNode<Ctx> = until("stay with them until the paramedics arrive", (c) => {
  const { world, task } = c;
  if (world.t - Number(task.data.lastStayCheck) >= STAY_CHECK_MINS * 60) {
    task.data.lastStayCheck = world.t;
    markChecked(world, c.resident!, [responder(c)], false);
  }
  const paramedics = world.people.get(PARAMEDICS_ID)!;
  return paramedics.onMap && paramedics.atPoint === point(c) && !paramedics.move;
});

export const fallTree: BtNode<Ctx> = seq(
  "fall",
  goTo("go to them", (c) => [responder(c)], (c) => [point(c)]),
  act("found", (c) => {
    // Someone coming back to a fall already found (after helping with another resident's lift) doesn't find it again.
    if (c.task.startedT === null) {
      c.task.startedT = c.world.t;
      emit(c.world, "fall.found", [c.resident!.id, responder(c).id], { residentId: c.resident!.id, staffId: responder(c).id });
    }
    setBadges([responder(c)], ["alert"], c.task.label);
    markChecked(c.world, c.resident!, [responder(c)], false);
  }),
  sel(
    "assessment",
    cond("already assessed?", (c) => c.resident!.resident!.fall!.assessed),
    seq(
      "the RN comes (day)",
      // By day the RN comes; at night an on-call RN who came over for another fall assesses in person.
      cond("RN on the wing?", (c) => (c.task.data.byPhone === 0 && rnOnWing(c.world) !== null) || isNurse(responder(c))),
      leaf("call the RN", (c) => {
        const rn = isNurse(responder(c)) ? responder(c) : rnOnWing(c.world);
        if (!rn) return "failure"; // gone off shift while we waited: phone the on-call RN
        if (rn !== responder(c)) {
          // With another resident, or needed first by a fall nobody has reached: the carer stays and waits for her.
          if (!available(c.world, rn) || unattended(c.world)) return "running";
          join(c.world, c.task, rn);
        }
        c.task.data.rn = rn.id;
        emit(c.world, "fall.rn_called", [c.resident!.id, responder(c).id], { residentId: c.resident!.id, staffId: responder(c).id, onCall: false });
        return "success";
      }),
      goTo("the RN comes", (c) => [c.world.people.get(String(c.task.data.rn))!], (c) => [point(c)]),
      waitMins("the RN assesses", () => RN_ASSESS_MINS),
      act("assessed", (c) => assessed(c, String(c.task.data.rn))),
    ),
    seq(
      "on-call RN by phone",
      act("phone", (c) => {
        setBadges([responder(c)], ["phone"], c.task.label);
        emit(c.world, "fall.rn_called", [c.resident!.id, responder(c).id], { residentId: c.resident!.id, staffId: responder(c).id, onCall: true });
      }),
      waitMins("phone assessment", (c) => Number(c.task.data.phoneMins)),
      act("assessed", (c) => assessed(c, "on-call RN")),
    ),
  ),
  sel(
    "outcome",
    seq(
      "minor: lift with the hoist",
      cond("minor?", (c) => c.resident!.resident!.fall!.severity === "minor"),
      secondPairOfHands,
      act("start the lift", (c) => {
        c.task.data.phase = "performing";
        setBadges(c.staff, ["hoist"], c.task.label);
      }),
      waitMins("hoist lift", () => LIFT_MINS),
      act("lifted", (c) => {
        const { world, task } = c;
        const r = c.resident!;
        const res = r.resident!;
        const toBed = isNight(world.t) || task.data.wasInBed === 1 || res.data.care.bed_bound;
        task.data.phase = null;
        releaseStand(world, r);
        if (toBed) getIntoBed(world, r);
        else {
          placeAt(world, r, chairFor(r));
          r.posture = "sitting";
        }
        emit(world, "fall.lifted", [r.id, ...task.assigned], { residentId: r.id, staffIds: [...task.assigned], to: toBed ? "bed" : "chair" });
        res.postFallUntil = world.t + POST_FALL_OBS_HOURS * 3600;
        markChecked(world, r, c.staff, false);
        informFamily(c, "fall, minor injury");
        cleanUp(c);
        // Off the floor: the red alert gives way to the calmer post-fall observations badge.
        r.badges = [...r.badges.filter((b) => b === "asleep"), "obs"];
      }),
    ),
    seq(
      "serious: ambulance",
      act("dial 999", (c) => {
        const { world, task } = c;
        if (task.data.ambulance === 1) return; // already on its way
        task.data.ambulance = 1;
        emit(world, "ambulance.called", [c.resident!.id, responder(c).id], { residentId: c.resident!.id, staffId: responder(c).id });
        world.paramedics.push({ taskId: task.id, dueT: world.t + world.rng.falls.int(30, 90) * 60 });
        // Only one carer needs to stay; anyone else goes back to work.
        for (const p of c.staff.slice(1)) {
          p.staff!.taskId = null;
          p.badges = [];
          p.task = null;
        }
        task.assigned = [responder(c).id];
        // With no RN on the wing, the on-call RN comes over to help until the paramedics have gone.
        if (task.data.byPhone === 1 && world.onCallRn.status === "off") {
          world.onCallRn = { status: "coming", arriveT: world.t + world.rng.falls.int(8, 12) * 60, residentId: c.resident!.id };
          emit(world, "on_call_rn.called", [c.resident!.id], { residentId: c.resident!.id, reason: "serious fall, waiting for an ambulance" });
        }
        // At night the floating carer covers the rest of the wing while the night carer waits.
        if (isNight(world.t) && world.float.status === "off") {
          world.metrics.floatCallouts += 1;
          emit(world, "second_carer.called", [floatPerson(world).id], { reason: "cover the wing while waiting for an ambulance", residentIds: [c.resident!.id], outOfRound: true });
          comeIn(world, false, world.rng.falls.int(8, 12));
        }
      }),
      waitForParamedics,
      waitMins("paramedics assess and lift", () => PARAMEDIC_HANDOVER_MINS),
      act("conveyed to hospital", (c) => {
        const { world } = c;
        const r = c.resident!;
        emit(world, "resident.conveyed_to_hospital", [r.id, PARAMEDICS_ID], { residentId: r.id, cause: "serious_fall" });
        emit(world, "cqc.notification_flagged", [r.id], { residentId: r.id, regulation: "Registration Regulations 2009, Regulation 18", reason: "serious injury after a fall" });
        informFamily(c, "fall, taken to hospital");
        cleanUp(c);
        // Leaves with the crew; back after a stay set by cause (health.ts, docs/10).
        leaveForHospital(world, r, "serious_fall");
        const paramedics = world.people.get(PARAMEDICS_ID)!;
        paramedics.staff!.duty = "leaving";
        walkTo(world, paramedics, "ExitDoor");
        world.paramedics = world.paramedics.filter((call) => call.taskId !== c.task.id);
      }),
    ),
  ),
);

/** Brings the paramedics and the on-call RN in when due, and sends the RN back afterwards (each minute). */
export function fallsMinute(world: World): void {
  const rn = world.people.get(ON_CALL_RN_ID)!;
  const call = world.onCallRn;
  if (call.status === "coming" && world.t >= call.arriveT! && !world.spawnQueue.includes(ON_CALL_RN_ID)) {
    call.status = "on_site";
    rn.staff!.duty = "arriving";
    world.spawnQueue.push(ON_CALL_RN_ID);
  }
  // She stays while any fall is in progress (she may have come because nobody was free for one),
  // and until she has given a medication round nobody on the wing could.
  const fallOngoing = world.paramedics.length > 0 || [...world.tasks.values()].some((t) => t.kind === "fall");
  const roundToGive = world.pendingRounds.length > 0 || [...world.tasks.values()].some((t) => t.kind === "med_round" && t.members!.includes(ON_CALL_RN_ID));
  if (call.status === "on_site" && rn.onMap && rn.staff!.duty === "on_shift" && !rn.staff!.taskId && !fallOngoing && !roundToGive) {
    call.status = "leaving";
    rn.staff!.duty = "leaving";
    rn.badges = [];
    rn.task = null;
    walkTo(world, rn, "ExitDoor");
  }

  const main = world.people.get(MAIN_CARER_ID);
  const m = world.mainCarer;
  if (main && m.status === "coming" && world.t >= m.arriveT! && !world.spawnQueue.includes(MAIN_CARER_ID)) {
    m.status = "on_site";
    main.staff!.duty = "arriving";
    world.spawnQueue.push(MAIN_CARER_ID);
  }
  if (main && m.status === "on_site" && main.onMap && main.staff!.duty === "on_shift" && !main.staff!.taskId && !fallOngoing) {
    m.status = "leaving";
    main.staff!.duty = "leaving";
    main.badges = [];
    main.task = null;
    walkTo(world, main, "ExitDoor");
  }

  // Post-fall observations end.
  for (const id of world.order) {
    const p = world.people.get(id)!;
    const res = p.resident;
    if (!res) continue;
    if (p.badges.includes("obs") && world.t >= res.postFallUntil) {
      p.badges = p.badges.filter((b) => b !== "obs");
      emit(world, "fall.observations_ended", [p.id], { residentId: p.id });
    }
  }

  // One crew answers the calls in turn, the one due soonest first.
  const due = nextCall(world);
  const paramedics = world.people.get(PARAMEDICS_ID)!;
  if (due && world.t >= due.dueT && !paramedics.onMap && !world.spawnQueue.includes(PARAMEDICS_ID)) {
    paramedics.staff!.duty = "arriving";
    world.spawnQueue.push(PARAMEDICS_ID);
  }
}

export function onCallRnArrived(world: World, rn: Person): void {
  rn.staff!.duty = "on_shift";
  emit(world, "on_call_rn.arrived", [rn.id], { personId: rn.id, residentId: world.onCallRn.residentId ?? "" });
  walkTo(world, rn, "Corridor.East");
}

export function mainCarerArrived(world: World, p: Person): void {
  p.staff!.duty = "on_shift";
  emit(world, "main_carer.arrived", [p.id], { personId: p.id });
  walkTo(world, p, "Corridor.Mid");
}

export function mainCarerDeparted(world: World, p: Person): void {
  world.mainCarer = { status: "off", arriveT: null, retryT: 0 };
  emit(world, "main_carer.departed", [p.id], { personId: p.id });
}

export function onCallRnDeparted(world: World, rn: Person): void {
  world.onCallRn = { status: "off", arriveT: null, residentId: null };
  emit(world, "on_call_rn.departed", [rn.id], { personId: rn.id });
}

function nextCall(world: World): { taskId: string; dueT: number } | undefined {
  return [...world.paramedics].sort((a, b) => a.dueT - b.dueT || a.taskId.localeCompare(b.taskId))[0];
}

/** Called when the paramedics appear at the exit door. */
export function paramedicsArrived(world: World, paramedics: Person): void {
  const call = nextCall(world);
  const task = call ? world.tasks.get(call.taskId) : undefined;
  paramedics.staff!.duty = "on_shift";
  if (!task) return;
  emit(world, "paramedics.arrived", [task.residentId!, paramedics.id], { residentId: task.residentId! });
  walkTo(world, paramedics, String(task.data.point));
}

// Falls (docs/05 "Fall response", spec decision 8). In Phase 1 falls only happen when a user
// injects one. Nobody moves a fallen resident until they have been assessed:
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
import { isCareStaff, isNurse, type Person, type World } from "./state.js";
import { newBtState } from "./bt.js";
import { pullOff, resetTask } from "./tasks.js";
import { chairFor, goTo, markChecked, setBadges, waitMins, type Ctx } from "./trees.js";
import { cellAt, cellCentre } from "./world/grid.js";
import { getIntoBed, placeAt, releaseStand, walkTo } from "./world/movement.js";

export const PARAMEDICS_ID = "ext_paramedics";
export const ON_CALL_RN_ID = "ext_oncall_rn";
const RN_ASSESS_MINS = 10;
const LIFT_MINS = 5;
const PARAMEDIC_HANDOVER_MINS = 10;
const POST_FALL_OBS_HOURS = 4;
/** While waiting with someone, the carer's presence counts as a check this often. */
const STAY_CHECK_MINS = 15;

function onWing(p: Person): boolean {
  return p.onMap && (p.staff?.duty === "on_shift" || p.staff?.duty === "staying");
}

function rnOnWing(world: World): Person | null {
  return world.order.map((id) => world.people.get(id)!).find((p) => isNurse(p) && onWing(p)) ?? null;
}

/** Care staff on the wing, nearest first, preferring people not in a handover. */
function nearestCarers(world: World, to: Person, exclude: string[]): Person[] {
  const inMeeting = (p: Person) => {
    const task = p.staff?.taskId ? world.tasks.get(p.staff.taskId) : undefined;
    return task?.kind === "handover" || task?.kind === "briefing" || task?.kind === "fall";
  };
  return world.order
    .map((id) => world.people.get(id)!)
    .filter((p) => isCareStaff(p) && onWing(p) && !exclude.includes(p.id))
    .sort((a, b) => Number(inMeeting(a)) - Number(inMeeting(b)) || Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y) || a.id.localeCompare(b.id));
}

function join(world: World, taskId: string, p: Person): void {
  pullOff(world, p, "called to a fall");
  p.staff!.taskId = taskId;
  world.tasks.get(taskId)!.assigned.push(p.id);
}

/** Applies an `inject_fall` input. */
export function injectFall(world: World, residentId: string, severity: FallSeverity, source: Source): void {
  const r = world.people.get(residentId);
  const res = r?.resident;
  if (!r || !res || !r.onMap || res.fall) return;

  // Whatever they were doing stops.
  for (const task of [...world.tasks.values()]) {
    if (task.residentId !== r.id) continue;
    if (task.kind === "self_toilet") {
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
    status: "active" as const,
    bt: newBtState(),
    data: {
      severity,
      point: point.id,
      wasInBed: wasInBed ? 1 : 0,
      byPhone: rnOnWing(world) ? 0 : 1,
      phoneMins: world.rng.falls.int(3, 5),
      rn: null,
      lastStayCheck: 0,
    } as Record<string, number | string | string[] | null>,
  };
  world.tasks.set(task.id, task);
  res.busyTaskId = task.id;
  res.fall = { t: world.t, severity, assessed: false, taskId: task.id };
  const responder = nearestCarers(world, r, [])[0];
  if (responder) join(world, task.id, responder);
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

/** Someone else to help lift: by day the nearest other carer; at night the floating carer. */
const secondPairOfHands: BtNode<Ctx> = leaf("get a second pair of hands", (c) => {
  const { world, task } = c;
  const float = floatPerson(world);
  if (task.assigned.length < 2) {
    if (!isNight(world.t)) {
      const other = nearestCarers(world, c.resident!, task.assigned).find((p) => p.id !== float.id);
      if (other) join(world, task.id, other);
    } else if (float.onMap && float.staff!.duty === "on_shift") {
      join(world, task.id, float);
    } else if (world.float.status === "off") {
      world.metrics.floatCallouts += 1;
      emit(world, "second_carer.called", [float.id], { reason: "help to lift after a fall", residentIds: [c.resident!.id], outOfRound: true });
      comeIn(world, false, world.rng.falls.int(8, 12));
    }
  }
  if (task.assigned.length < 2) return "running";
  let moving = false;
  for (const p of task.assigned.map((id) => world.people.get(id)!)) {
    if (p.atPoint !== point(c)) {
      if (p.move?.destPointId !== point(c)) walkTo(world, p, point(c));
      moving = true;
    }
  }
  return moving ? "running" : "success";
});

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
    c.task.startedT = c.world.t;
    emit(c.world, "fall.found", [c.resident!.id, responder(c).id], { residentId: c.resident!.id, staffId: responder(c).id });
    setBadges([responder(c)], ["alert"], c.task.label);
    markChecked(c.world, c.resident!, [responder(c)], false);
  }),
  sel(
    "assessment",
    seq(
      "the RN comes (day)",
      cond("RN on the wing?", (c) => c.task.data.byPhone === 0 && rnOnWing(c.world) !== null),
      act("call the RN", (c) => {
        const rn = isNurse(responder(c)) ? responder(c) : rnOnWing(c.world)!;
        if (rn !== responder(c)) join(c.world, c.task.id, rn);
        c.task.data.rn = rn.id;
        emit(c.world, "fall.rn_called", [c.resident!.id, responder(c).id], { residentId: c.resident!.id, staffId: responder(c).id, onCall: false });
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
      }),
    ),
    seq(
      "serious: ambulance",
      act("dial 999", (c) => {
        const { world, task } = c;
        emit(world, "ambulance.called", [c.resident!.id, responder(c).id], { residentId: c.resident!.id, staffId: responder(c).id });
        world.paramedics = { taskId: task.id, dueT: world.t + world.rng.falls.int(30, 90) * 60 };
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
        emit(world, "resident.conveyed_to_hospital", [r.id, PARAMEDICS_ID], { residentId: r.id });
        emit(world, "cqc.notification_flagged", [r.id], { residentId: r.id, regulation: "Registration Regulations 2009, Regulation 18", reason: "serious injury after a fall" });
        informFamily(c, "fall, taken to hospital");
        cleanUp(c);
        releaseStand(world, r);
        Object.assign(r, { onMap: false, move: null, atPoint: null, roomId: null, posture: "in_bed", task: null });
        r.resident!.away = "hospital";
        r.resident!.busyTaskId = null;
        for (const t of [...world.tasks.values()]) if (t.residentId === r.id && t.kind !== "fall") world.tasks.delete(t.id);
        const paramedics = world.people.get(PARAMEDICS_ID)!;
        paramedics.staff!.duty = "leaving";
        walkTo(world, paramedics, "ExitDoor");
        world.paramedics = null;
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
  const seriousFallOngoing = world.paramedics !== null || [...world.tasks.values()].some((t) => t.kind === "fall" && t.data.severity === "serious");
  if (call.status === "on_site" && rn.onMap && rn.staff!.duty === "on_shift" && !rn.staff!.taskId && !seriousFallOngoing) {
    call.status = "leaving";
    rn.staff!.duty = "leaving";
    rn.badges = [];
    rn.task = null;
    walkTo(world, rn, "ExitDoor");
  }

  const due = world.paramedics;
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

export function onCallRnDeparted(world: World, rn: Person): void {
  world.onCallRn = { status: "off", arriveT: null, residentId: null };
  emit(world, "on_call_rn.departed", [rn.id], { personId: rn.id });
}

/** Called when the paramedics appear at the exit door. */
export function paramedicsArrived(world: World, paramedics: Person): void {
  const task = world.paramedics ? world.tasks.get(world.paramedics.taskId) : undefined;
  paramedics.staff!.duty = "on_shift";
  if (!task) return;
  emit(world, "paramedics.arrived", [task.residentId!, paramedics.id], { residentId: task.residentId! });
  walkTo(world, paramedics, String(task.data.point));
}

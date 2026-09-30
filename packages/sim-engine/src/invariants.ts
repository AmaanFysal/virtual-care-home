// Per-tick checks (spec "Invariants", docs/11), in two classes:
// - Hard safety invariants must hold in every run, including fall runs; the engine logs
//   `invariant.violated` when one starts failing.
// - Service targets (request waits, check intervals) are reported, not failures; the engine logs
//   `sla.breached` with the likely cause (e.g. during a serious fall).
// Tests call both functions every tick.

import type { ServiceTarget } from "@vch/shared-types";
import { SUPERVISION_MINS, supervisedResidents } from "./lounge.js";
import { cellAt } from "./world/grid.js";
import { floorCovered } from "./floor.js";
import { isMedsTrained } from "./meds.js";
import { checkInterval, isNight } from "./nightcover.js";
import { isCareStaff, isNurse, onDuty, type World } from "./state.js";

export interface Violation {
  rule: string;
  /** Distinguishes separate failures of the same rule (a request id, a resident id). */
  key?: string;
  details: string;
}

export function checkInvariants(world: World): Violation[] {
  const out: Violation[] = [];
  const people = world.order.map((id) => world.people.get(id)!);

  if (!floorCovered(world)) out.push({ rule: "floor_cover", details: "no on-duty care staff on the floor" });

  // Standing spots: nobody shares a cell while stationary.
  const byCell = new Map<number, string[]>();
  for (const p of people) {
    if (!p.onMap || p.move) continue;
    const cell = cellAt(world.grid, p.x, p.y);
    byCell.set(cell, [...(byCell.get(cell) ?? []), p.id]);
  }
  for (const [cell, ids] of byCell) {
    if (ids.length > 1) out.push({ rule: "standing_spot", details: `${ids.join(", ")} share cell ${cell}` });
  }

  // Two-person care is only ever carried out with two staff at the resident.
  for (const task of world.tasks.values()) {
    if (task.staffNeeded !== 2 || task.data.phase !== "performing") continue;
    const resident = world.people.get(task.residentId!)!;
    const near = task.assigned.filter((id) => {
      const s = world.people.get(id)!;
      return s.onMap && !s.move && Math.hypot(s.x - resident.x, s.y - resident.y) <= 2.5;
    });
    if (near.length < 2) out.push({ rule: "two_person", details: `${task.id} (${task.label}) with ${near.length} staff` });
  }

  if (!world.rnOnCall && !people.some((p) => isNurse(p) && onDuty(p))) out.push({ rule: "rn_reachable", details: "no RN on the map and none on call" });

  // Nobody is left on the floor: someone is with them or on the way, or help has been asked for.
  for (const p of people) {
    const since = p.resident?.fall?.uncoveredSinceT;
    if (since !== null && since !== undefined && world.t - since > FALL_UNATTENDED_SECS) {
      out.push({ rule: "fall_unattended", key: p.id, details: `${p.id} on the floor for ${Math.round((world.t - since) / 60)} min with nobody attending and no help asked for` });
    }
  }

  for (const p of people) {
    if (p.kind === "visitor" && p.onMap && p.roomId === "StaffRoom") out.push({ rule: "no_visitors_in_staff_room", details: p.id });
  }

  return out;
}

export interface Breach {
  target: ServiceTarget;
  residentId: string;
  key: string;
  details: string;
  /** Set when the target knows its own cause (a fall nobody could reach). */
  cause?: string;
}

/** A fallen resident with nobody coming and no help asked for, for longer than this, breaks a hard rule. */
const FALL_UNATTENDED_SECS = 120;
/** Someone should be with a fallen resident within this many minutes (the `fall_attendance` service target). */
export const FALL_ATTENDANCE_MINS = 5;
/** A resident left waiting for a lift (docs/05 "Several falls at once") is looked in on at least this often. */
export const FALL_WAITING_CHECK_MINS = 5;

/**
 * Service targets: every request helped within its limit; everyone checked within their interval;
 * turns on time; and while Peggy or Stan is in the Lounge, a carer there or looking in at least
 * every 15 minutes.
 */
export function checkServiceTargets(world: World): Breach[] {
  const out: Breach[] = [];
  for (const p of world.order.map((id) => world.people.get(id)!)) {
    const res = p.resident;
    if (!res || !p.onMap) continue;
    const interval = checkInterval(res);
    if (world.t - res.lastCheckedT > interval * 60) {
      out.push({ target: "resident_check", residentId: p.id, key: p.id, details: `${p.id} unchecked for ${Math.round((world.t - res.lastCheckedT) / 60)} min (interval ${interval})` });
    }
  }
  // Repositioning: bed-bound residents day and night; others (Raj) only when in bed at night.
  for (const p of world.order.map((id) => world.people.get(id)!)) {
    const res = p.resident;
    if (!res || !p.onMap || !res.inBed) continue;
    const care = res.data.care;
    const interval = care.bed_bound ? (isNight(res.lastTurnedT) ? care.reposition_interval_mins.night : care.reposition_interval_mins.day) : isNight(world.t) ? care.reposition_interval_mins.night : null;
    if (interval && world.t - res.lastTurnedT > interval * 60) {
      out.push({ target: "reposition", residentId: p.id, key: p.id, details: `${p.id} not turned for ${Math.round((world.t - res.lastTurnedT) / 60)} min (interval ${interval})` });
    }
  }
  for (const task of world.tasks.values()) {
    if (!task.request || task.startedT !== null || task.deadlineT === null || world.t <= task.deadlineT) continue;
    out.push({ target: "request_wait", residentId: task.residentId!, key: task.id, details: `${task.label} waiting ${Math.round((world.t - task.createdT) / 60)} min` });
  }
  // Time from a fall to someone being with them.
  for (const task of world.tasks.values()) {
    if (task.kind !== "fall" || task.startedT !== null || world.t - task.createdT <= FALL_ATTENDANCE_MINS * 60) continue;
    const r = world.people.get(task.residentId!)!;
    out.push({
      target: "fall_attendance",
      residentId: r.id,
      key: task.id,
      details: `${r.id} on the floor ${Math.round((world.t - task.createdT) / 60)} min before anyone reached them`,
      cause: task.data.helpReason ? String(task.data.helpReason) : "a carer on the way",
    });
  }
  // A resident left waiting on the floor while their carer helps with another lift is looked in on every 5 minutes.
  for (const task of world.tasks.values()) {
    if (task.kind !== "fall" || task.data.leftT === null || task.data.leftT === undefined || task.assigned.length > 0) continue;
    const since = world.t - Number(task.data.lastCheckT);
    if (since <= FALL_WAITING_CHECK_MINS * 60) continue;
    out.push({
      target: "fall_waiting_check",
      residentId: task.residentId!,
      key: task.id,
      details: `${task.residentId} waiting on the floor for a lift, not looked in on for ${Math.round(since / 60)} min`,
      cause: `${String(task.data.leftReason)}; nobody else free to look in`,
    });
  }
  const unsupervised = supervisedResidents(world);
  if (unsupervised.length > 0 && world.t - world.loungeSeenT > SUPERVISION_MINS * 60) {
    const names = unsupervised.map((p) => p.name.split(" ")[0]).join(" and ");
    out.push({ target: "lounge_supervision", residentId: unsupervised[0]!.id, key: "lounge", details: `${names} in the Lounge with no carer for ${Math.round((world.t - world.loungeSeenT) / 60)} min` });
  }
  return out;
}

/** Why a target was probably missed: a fall in progress, one in the last two hours, or post-fall observations. */
export function breachCause(world: World): string {
  const name = (id: string) => world.people.get(id)!.name.split(" ")[0];
  const ongoing = world.fallLog.find((f) => f.endT === null);
  if (ongoing) return `during ${ongoing.severity} fall (${name(ongoing.residentId)})`;
  const recent = world.fallLog.findLast((f) => f.endT !== null && world.t - f.endT < 2 * 3600);
  if (recent) return `after ${recent.severity} fall (${name(recent.residentId)})`;
  const observing = world.order.find((id) => (world.people.get(id)!.resident?.postFallUntil ?? 0) > world.t);
  if (observing) return `during post-fall observations (${name(observing)})`;
  return "no emergency";
}

/** What the care staff were doing, for a missed target with no emergency behind it. */
export function staffBusyCause(world: World): string {
  const doing = world.order
    .map((id) => world.people.get(id)!)
    .filter((p) => isCareStaff(p) && onDuty(p))
    .map((p) => {
      const task = p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined;
      return `${p.name.split(" ")[0]}: ${task ? task.label : p.roomId === "StaffRoom" ? "in the staff room" : "free"}`;
    });
  return `no emergency; ${doing.join(", ")}`;
}


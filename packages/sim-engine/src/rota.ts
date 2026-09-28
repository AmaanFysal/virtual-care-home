// Rota system (docs/05): plans each day's shifts at 00:00, brings staff in through the exit
// door before their shift, starts and ends shifts, fills agency slots and tracks RN on-call.
//
// Until M4a adds handovers and tasks, on-shift staff wait at a fixed post.

import {
  AGENCY,
  SECONDS_PER_DAY,
  WEEKDAYS,
  clockToSeconds,
  dayIndex,
  timeOfDay,
  type ShiftName,
  type Staff,
} from "@vch/shared-types";
import { emit } from "./emit.js";
import type { Person, ShiftAssignment, World } from "./state.js";
import { depart, walkTo } from "./world/movement.js";

/** Where each slot waits while on shift (placeholder until tasks exist). */
const POSTS: Record<string, string> = {
  "early.lead": "Corridor.Mid",
  "early.ca": "Corridor.West",
  "late.lead": "Corridor.Mid",
  "late.ca": "Corridor.West",
  "night.carer": "Corridor.Mid",
  "rn_day.nurse": "Corridor.East",
};
/** Office and reception staff have fixed workplaces. There is no separate office in v1. */
const WORKPLACES: Record<string, string> = {
  stf_joanne: "StaffRoom.Seat6",
  stf_bev: "WaitingArea.Seat1",
  stf_sanjay: "Reception.DeskStaff",
};
const STAFF_ROOM_SEATS = ["StaffRoom.Seat1", "StaffRoom.Seat2", "StaffRoom.Seat3", "StaffRoom.Seat4", "StaffRoom.Seat5"];

export function postFor(assignment: ShiftAssignment): string {
  return POSTS[assignment.slot] ?? WORKPLACES[assignment.personId] ?? "Corridor.Mid";
}

export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w) && !["Sister", "Father"].includes(w));
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1]![0] : "")).toUpperCase();
}

export function staffPerson(s: Staff): Person {
  return {
    id: s.id,
    kind: "staff",
    name: s.name,
    initials: initials(s.name),
    gender: s.gender,
    speed: s.walk_speed_mps,
    onMap: false,
    x: 0,
    y: 0,
    roomId: null,
    posture: "standing",
    badges: [],
    task: null,
    move: null,
    atPoint: null,
    heldZone: null,
    waitingAtDoor: null,
    staff: { role: s.role, competencies: [...s.competencies], duty: "off", shift: null },
  };
}

export function addPerson(world: World, person: Person): void {
  world.people.set(person.id, person);
  world.order.push(person.id);
  world.order.sort();
}

/** Creates the day's shift assignments, drawing arrival times and agency names from the rota stream. */
export function planDay(world: World, day: number): void {
  if (world.plannedDays.has(day)) return;
  world.plannedDays.add(day);
  const { rota } = world.data;
  const rotaDay = rota.week[WEEKDAYS[day % 7]!];
  const rng = world.rng.rota;
  const namesInUse = new Set<string>();

  const slots: { shift: ShiftName; slot: string; who: string }[] = [
    { shift: "early", slot: "early.lead", who: rotaDay.early.lead },
    { shift: "early", slot: "early.ca", who: rotaDay.early.ca },
    { shift: "rn_day", slot: "rn_day.nurse", who: rotaDay.rn_day.nurse },
    ...rotaDay.reception.map((who) => ({ shift: "reception" as const, slot: "reception", who })),
    ...rotaDay.office.map((who) => ({ shift: "office" as const, slot: "office", who })),
    { shift: "late", slot: "late.lead", who: rotaDay.late.lead },
    { shift: "late", slot: "late.ca", who: rotaDay.late.ca },
    { shift: "night", slot: "night.carer", who: rotaDay.night.carer },
  ];

  for (const { shift, slot, who } of slots) {
    const times = rota.shifts[shift];
    const startT = day * SECONDS_PER_DAY + clockToSeconds(times.start);
    let endT = day * SECONDS_PER_DAY + clockToSeconds(times.end);
    if (endT <= startT) endT += SECONDS_PER_DAY;

    let personId = who;
    let early = rng.int(5, 15);
    if (who === AGENCY) {
      const isNurse = shift === "rn_day";
      const pool = isNurse ? rota.agency_pool.nurse : rota.agency_pool.carer;
      const free = pool.filter((w) => !namesInUse.has(w.name));
      const worker = rng.pick(free.length > 0 ? free : pool);
      namesInUse.add(worker.name);
      world.agencyCount += 1;
      personId = `agy_${String(world.agencyCount).padStart(3, "0")}`;
      addPerson(world, {
        ...staffPerson({
          id: personId,
          name: worker.name,
          gender: worker.gender,
          walk_speed_mps: 1.2,
          role: isNurse ? "registered_nurse" : "care_assistant",
          competencies: isNurse ? ["meds_trained", "fall_assessment", "moving_handling"] : ["moving_handling"],
        } as Staff),
        kind: "agency",
        staff: {
          role: isNurse ? "agency_nurse" : "agency_carer",
          competencies: isNurse ? ["meds_trained", "fall_assessment", "moving_handling"] : ["moving_handling"],
          duty: "off",
          shift: null,
        },
      });
      early = rng.int(0, 10);
    }
    world.shifts.push({ personId, shift, slot, arriveT: startT - early * 60, startT, endT, spawned: false, started: false, ended: false });
  }
  world.shifts.sort((a, b) => a.arriveT - b.arriveT || a.personId.localeCompare(b.personId));
}

function freeStaffRoomSeat(world: World): string {
  const taken = new Set([...world.people.values()].map((p) => p.atPoint ?? p.move?.destPointId));
  return STAFF_ROOM_SEATS.find((s) => !taken.has(s)) ?? STAFF_ROOM_SEATS[0]!;
}

function startShift(world: World, a: ShiftAssignment, person: Person): void {
  a.started = true;
  person.staff!.duty = "on_shift";
  emit(world, "shift.started", [person.id], { staffId: person.id, shift: a.shift, slot: a.slot });
  if (a.shift === "rn_day" && world.rnOnCall) {
    world.rnOnCall = false;
    emit(world, "rn.on_call_ended", [], { nurseLabel: "On-call RN (main building)" });
  }
  if (person.onMap) walkTo(world, person, postFor(a));
}

/** Runs on minute boundaries. */
export function rotaMinute(world: World): void {
  const t = world.t;
  if (timeOfDay(t) === 0) planDay(world, dayIndex(t));

  for (const a of world.shifts) {
    const person = world.people.get(a.personId)!;
    if (!a.spawned && t >= a.arriveT) {
      a.spawned = true;
      person.staff!.shift = a;
      person.staff!.duty = "arriving";
      if (person.kind === "agency") emit(world, "agency.spawned", [person.id], { staffId: person.id, role: person.staff!.role === "agency_nurse" ? "nurse" : "carer", shift: a.shift });
      world.spawnQueue.push(person.id);
    }
    if (a.spawned && !a.started && t >= a.startT) startShift(world, a, person);
    if (a.started && !a.ended && t >= a.endT) {
      a.ended = true;
      person.staff!.duty = "leaving";
      emit(world, "shift.ended", [person.id], { staffId: person.id, shift: a.shift, slot: a.slot });
      if (a.shift === "rn_day") {
        world.rnOnCall = true;
        emit(world, "rn.on_call_started", [], { nurseLabel: "On-call RN (main building)" });
      }
      if (person.onMap) walkTo(world, person, "ExitDoor");
      else world.spawnQueue.splice(world.spawnQueue.indexOf(person.id), 1);
    }
  }
  pruneShifts(world, t - SECONDS_PER_DAY);
}

/** Forgets shifts that ended before `before`, and agency workers who have gone home. */
function pruneShifts(world: World, before: number): void {
  const gone = world.shifts.filter((a) => a.ended && a.endT < before);
  if (gone.length === 0) return;
  world.shifts = world.shifts.filter((a) => !gone.includes(a));
  for (const a of gone) {
    const person = world.people.get(a.personId);
    if (person?.kind === "agency" && !person.onMap) {
      world.people.delete(person.id);
      world.order = world.order.filter((id) => id !== person.id);
    }
  }
}

/** Called after spawning and movement each tick. */
export function rotaArrivals(world: World, spawned: string[], arrived: string[]): void {
  for (const id of spawned) {
    const person = world.people.get(id)!;
    const a = person.staff?.shift;
    if (!a) continue;
    walkTo(world, person, a.started ? postFor(a) : freeStaffRoomSeat(world));
  }
  for (const id of arrived) {
    const person = world.people.get(id)!;
    if (person.staff?.duty === "leaving" && person.atPoint === "ExitDoor") {
      depart(world, person);
      person.staff.duty = "off";
      person.staff.shift = null;
    }
  }
}

/** Places staff whose shift is already under way at the start time (docs/05 initial state). */
export function placeInitialStaff(world: World): void {
  const t = world.startT;
  planDay(world, dayIndex(t) - 1);
  planDay(world, dayIndex(t));
  world.rnOnCall = true;
  for (const a of world.shifts) {
    if (a.arriveT > t || a.endT <= t) {
      if (a.endT <= t) (a.spawned = true), (a.started = true), (a.ended = true);
      continue;
    }
    const person = world.people.get(a.personId)!;
    const pointId = t >= a.startT ? postFor(a) : freeStaffRoomSeat(world);
    const point = world.points.get(pointId)!;
    Object.assign(person, { onMap: true, x: point.x, y: point.y, roomId: point.room, atPoint: pointId, posture: point.kind === "seat" ? "sitting" : "standing" });
    person.staff!.shift = a;
    a.spawned = true;
    if (t >= a.startT) {
      a.started = true;
      person.staff!.duty = "on_shift";
      if (a.shift === "rn_day") world.rnOnCall = false;
    } else {
      person.staff!.duty = "arriving";
    }
  }
  pruneShifts(world, t + 1);
}

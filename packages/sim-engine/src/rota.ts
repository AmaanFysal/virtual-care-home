// Rota system (docs/05): plans each day's shifts at 00:00, brings staff in through the exit
// door before their shift, starts and ends shifts, creates the three daily handovers, plans
// staggered breaks, fills agency slots and tracks RN on-call. Staff whose shift has ended stay
// on until they finish their task and someone else covers the floor.

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
import { coveredWithout } from "./floor.js";
import { isCareStaff, type Person, type ShiftAssignment, type World } from "./state.js";
import { floatArrived, floatDeparted } from "./float.js";
import { createHandover, idleStaff } from "./tasks.js";
import { depart, placeAt, walkTo } from "./world/movement.js";

/** Where each slot waits on the floor when there's nothing to do. */
const POSTS: Record<string, string> = {
  "early.lead": "Corridor.Mid",
  "early.ca": "Corridor.West",
  "late.lead": "Corridor.Mid",
  "late.ca": "Corridor.West",
  "night.carer": "Corridor.Mid",
  "rn_day.nurse": "Corridor.East",
};
/** Office and reception staff have fixed workplaces; the staff room stays for handovers and breaks. */
const WORKPLACES: Record<string, string> = {
  stf_joanne: "Reception.Office",
  stf_bev: "WaitingArea.Seat1",
  stf_sanjay: "Reception.DeskStaff",
};
const STAFF_ROOM_SEATS = ["StaffRoom.Seat1", "StaffRoom.Seat2", "StaffRoom.Seat3", "StaffRoom.Seat4", "StaffRoom.Seat5", "StaffRoom.Seat6"];

/** Break start windows (docs/05 "Breaks"); each break is 30 minutes. */
const BREAK_WINDOWS: Record<ShiftName, [string, string]> = {
  early: ["10:30", "11:45"],
  late: ["17:30", "19:00"],
  rn_day: ["11:30", "12:15"],
  night: ["02:30", "03:30"],
  office: ["12:15", "12:45"],
  reception: ["12:15", "12:45"],
};

/** Handovers (docs/05): time, duration, and whether the lead briefs the floor cover after. */
const HANDOVERS = [
  { at: "07:00", mins: 15, brief: true },
  { at: "14:00", mins: 20, brief: false },
  { at: "21:15", mins: 15, brief: false },
] as const;

export function postFor(assignment: ShiftAssignment): string {
  return POSTS[assignment.slot] ?? WORKPLACES[assignment.personId] ?? "Corridor.Mid";
}

export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w) && !["Sister", "Father"].includes(w));
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1]![0] : "")).toUpperCase();
}

export function staffPerson(s: Pick<Staff, "id" | "name" | "gender" | "walk_speed_mps" | "role" | "competencies">): Person {
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
    standCell: null,
    heldZone: null,
    waitingAtDoor: null,
    staff: {
      role: s.role,
      competencies: [...s.competencies],
      duty: "off",
      shift: null,
      taskId: null,
      pausedBreakId: null,
      breakDueT: null,
      breakTaken: false,
      workload: 0,
    },
    resident: null,
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
      const competencies: Staff["competencies"] = isNurse ? ["meds_trained", "fall_assessment", "moving_handling"] : ["moving_handling"];
      const person = staffPerson({ id: personId, name: worker.name, gender: worker.gender, walk_speed_mps: 1.2, role: isNurse ? "registered_nurse" : "care_assistant", competencies });
      person.kind = "agency";
      person.staff!.role = isNurse ? "agency_nurse" : "agency_carer";
      addPerson(world, person);
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

function planBreak(world: World, a: ShiftAssignment, person: Person): void {
  const [from, to] = BREAK_WINDOWS[a.shift];
  const day = dayIndex(a.startT) + (clockToSeconds(from) < timeOfDay(a.startT) ? 1 : 0);
  const start = day * SECONDS_PER_DAY + clockToSeconds(from);
  const spread = (clockToSeconds(to) - clockToSeconds(from)) / 60;
  person.staff!.breakDueT = start + world.rng.decisions.int(0, spread) * 60;
  person.staff!.breakTaken = false;
}

function startShift(world: World, a: ShiftAssignment, person: Person): void {
  a.started = true;
  person.staff!.duty = "on_shift";
  planBreak(world, a, person);
  emit(world, "shift.started", [person.id], { staffId: person.id, shift: a.shift, slot: a.slot });
  if (a.shift === "rn_day" && world.rnOnCall) {
    world.rnOnCall = false;
    emit(world, "rn.on_call_ended", [], { nurseLabel: "On-call RN (main building)" });
  }
}

/** Who holds a slot on a given day (the night slot at 07:00 is yesterday's). */
function holder(world: World, day: number, slot: string): string | null {
  const shift = slot.split(".")[0] as ShiftName;
  const a = world.shifts.find((s) => s.slot === slot && s.shift === shift && dayIndex(s.startT) === day);
  return a?.personId ?? null;
}

function createHandovers(world: World): void {
  const tod = timeOfDay(world.t);
  const day = dayIndex(world.t);
  for (const h of HANDOVERS) {
    if (tod !== clockToSeconds(h.at)) continue;
    const list = (...ids: (string | null)[]) => ids.filter((id): id is string => !!id);
    if (h.at === "07:00") {
      createHandover(world, list(holder(world, day - 1, "night.carer")), list(holder(world, day, "early.lead"), holder(world, day, "rn_day.nurse")), holder(world, day, "early.ca"), h.mins, h.brief);
    } else if (h.at === "14:00") {
      createHandover(world, list(holder(world, day, "early.lead")), list(holder(world, day, "late.lead"), holder(world, day, "late.ca")), holder(world, day, "early.ca"), h.mins, h.brief);
    } else {
      createHandover(world, list(holder(world, day, "late.lead")), list(holder(world, day, "night.carer")), holder(world, day, "late.ca"), h.mins, h.brief);
    }
  }
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
      emit(world, "shift.ended", [person.id], { staffId: person.id, shift: a.shift, slot: a.slot });
      if (a.shift === "rn_day") {
        world.rnOnCall = true;
        emit(world, "rn.on_call_started", [], { nurseLabel: "On-call RN (main building)" });
      }
      if (person.onMap) person.staff!.duty = "staying";
      else {
        world.spawnQueue.splice(world.spawnQueue.indexOf(person.id), 1);
        person.staff!.duty = "off";
      }
    }
  }
  createHandovers(world);
  pruneShifts(world, t - SECONDS_PER_DAY);
}

/** Staff whose shift has ended leave once their task is done and the floor is covered without them. */
export function rotaLeaving(world: World): void {
  for (const id of world.order) {
    const p = world.people.get(id)!;
    const s = p.staff;
    if (!s || s.duty !== "staying" || s.taskId) continue;
    if (isCareStaff(p) && !coveredWithout(world, p)) continue;
    const owesHandover = [...world.tasks.values()].some((t) => t.members?.includes(p.id) && !t.assigned.includes(p.id));
    if (owesHandover) continue;
    if (s.pausedBreakId) world.tasks.delete(s.pausedBreakId);
    s.pausedBreakId = null;
    s.duty = "leaving";
    p.badges = [];
    p.task = null;
    walkTo(world, p, "ExitDoor");
  }
}

/** Idle on-shift staff wait at their floor post or workplace. */
export function sendIdleToPosts(world: World): void {
  for (const p of idleStaff(world)) {
    const a = p.staff!.shift;
    if (!a || p.move) continue;
    const post = postFor(a);
    if (p.atPoint !== post) walkTo(world, p, post);
  }
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
    if (person.id === world.data.rota.night_float.id) {
      floatArrived(world, person);
      continue;
    }
    const a = person.staff?.shift;
    if (a) walkTo(world, person, a.started ? postFor(a) : freeStaffRoomSeat(world));
  }
  for (const id of arrived) {
    const person = world.people.get(id)!;
    if (person.staff?.duty === "leaving" && person.atPoint === "ExitDoor") {
      depart(world, person);
      person.staff.duty = "off";
      person.staff.shift = null;
      if (person.id === world.data.rota.night_float.id) floatDeparted(world, person);
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
    placeAt(world, person, t >= a.startT ? postFor(a) : freeStaffRoomSeat(world));
    person.staff!.shift = a;
    a.spawned = true;
    if (t >= a.startT) {
      a.started = true;
      person.staff!.duty = "on_shift";
      planBreak(world, a, person);
      if (person.staff!.breakDueT! > t + 12 * 3600 || person.staff!.breakDueT! < t) person.staff!.breakTaken = true;
      if (a.shift === "rn_day") world.rnOnCall = false;
    } else {
      person.staff!.duty = "arriving";
    }
  }
  pruneShifts(world, t + 1);
}

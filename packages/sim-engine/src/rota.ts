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
import { ON_CALL_RN_ID, PARAMEDICS_ID, mainCarerArrived, mainCarerDeparted, onCallRnArrived, onCallRnDeparted, paramedicsArrived } from "./falls.js";
import { floatArrived, floatDeparted } from "./float.js";
import { coverableOnSite } from "./nightcover.js";
import { createHandover, idleStaff, pullOff } from "./tasks.js";
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
  stf_bev: "Lounge.Post",
  stf_sanjay: "Reception.DeskStaff",
};
const STAFF_ROOM_SEATS = ["StaffRoom.Seat1", "StaffRoom.Seat2", "StaffRoom.Seat3", "StaffRoom.Seat4", "StaffRoom.Seat5", "StaffRoom.Seat6"];

/** Break start windows (docs/05 "Breaks"); each break is 30 minutes. */
const BREAK_WINDOWS: Record<ShiftName, [string, string]> = {
  early: ["10:30", "11:45"],
  late: ["17:30", "19:00"],
  rn_day: ["11:30", "12:15"],
  // From 01:30 the lone night carer takes his break at the floating carer's next round, after its turns (tasks.ts).
  night: ["01:30", "01:30"],
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
    visitor: null,
    infection: null,
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
      personId = addAgencyWorker(world, worker, isNurse, false).id;
      early = rng.int(0, 10);
    }
    world.shifts.push({ personId, shift, slot, arriveT: startT - early * 60, startT, endT, spawned: false, started: false, ended: false });
  }
  world.shifts.sort((a, b) => a.arriveT - b.arriveT || a.personId.localeCompare(b.personId));
}

/**
 * Adds a booked agency worker (not yet on the map). A nurse is meds-trained and assesses falls; a
 * carer covering a shift lead's slot is a meds-trained senior (docs/10).
 */
export function addAgencyWorker(world: World, worker: { name: string; gender: Staff["gender"] }, isNurse: boolean, medsTrained: boolean): Person {
  world.agencyCount += 1;
  const id = `agy_${String(world.agencyCount).padStart(3, "0")}`;
  const competencies: Staff["competencies"] = isNurse ? ["meds_trained", "fall_assessment", "moving_handling"] : medsTrained ? ["meds_trained", "moving_handling"] : ["moving_handling"];
  const person = staffPerson({ id, name: worker.name, gender: worker.gender, walk_speed_mps: 1.2, role: isNurse ? "registered_nurse" : "care_assistant", competencies });
  person.kind = "agency";
  person.staff!.role = isNurse ? "agency_nurse" : "agency_carer";
  addPerson(world, person);
  return person;
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

/** Here and working (or staying on after) the late shift. */
function onTheLate(world: World, id: string): boolean {
  const p = world.people.get(id);
  return !!p?.onMap && (p.staff?.duty === "on_shift" || p.staff?.duty === "staying") && p.staff.shift?.shift === "late";
}

/** Who holds a slot on a given day (the night slot at 07:00 is yesterday's). */
export function holder(world: World, day: number, slot: string): string | null {
  const shift = slot.split(".")[0] as ShiftName;
  // A night split between the late carer staying on and the cover who relieves her (docs/10): whoever holds it now, else the last.
  const all = world.shifts.filter((s) => s.slot === slot && s.shift === shift && dayIndex(s.startT) === day);
  const a = all.find((s) => s.started && !s.ended) ?? all.sort((x, y) => x.startT - y.startT).at(-1);
  return a?.personId ?? null;
}

function createHandovers(world: World): void {
  const tod = timeOfDay(world.t);
  const day = dayIndex(world.t);
  for (const h of HANDOVERS) {
    if (tod !== clockToSeconds(h.at)) continue;
    const list = (...ids: (string | null)[]) => ids.filter((id): id is string => !!id);
    let from: string[], to: string[], coverSlot: string;
    if (h.at === "07:00") {
      [from, to, coverSlot] = [list(holder(world, day - 1, "night.carer")), list(holder(world, day, "early.lead"), holder(world, day, "rn_day.nurse")), "early.ca"];
    } else if (h.at === "14:00") {
      [from, to, coverSlot] = [list(holder(world, day, "early.lead")), list(holder(world, day, "late.lead"), holder(world, day, "late.ca")), "early.ca"];
    } else {
      // A late carer staying on for the night (docs/10) already knows the shift: no handover.
      const night = holder(world, day, "night.carer");
      if (night && (night === holder(world, day, "late.lead") || night === holder(world, day, "late.ca"))) continue;
      [from, to, coverSlot] = [list(holder(world, day, "late.lead")), list(night), "late.ca"];
    }
    let cover = holder(world, day, coverSlot);
    // The floor cover's slot is short (a sick call not yet covered, docs/10): an incoming member
    // who is here stays on the floor instead and reads the notes; with nobody here to cover or
    // to hand over to, the written notes stand in for the handover.
    if (slotShort(world, day, coverSlot)) {
      const here = (id: string) => !!world.people.get(id)?.onMap;
      cover = to.filter(here).at(-1) ?? null;
      to = to.filter((id) => id !== cover);
      if (!cover || !from.some(here) || !to.some(here)) continue;
    }
    createHandover(world, from, to, cover, h.mins, h.brief);
  }
}

/** Whether a slot is missing its worker right now: an absence with no cover, or cover not here yet. */
function slotShort(world: World, day: number, slot: string): boolean {
  return world.absences.some((a) => a.slot === slot && dayIndex(a.startT) === day && world.t < a.endT && (!a.cover || world.t < a.cover.arriveT));
}

/** Runs on minute boundaries. */
export function rotaMinute(world: World): void {
  const t = world.t;
  if (timeOfDay(t) === 0) planDay(world, dayIndex(t));

  for (const a of world.shifts) {
    // A late carer staying on to bridge a night (docs/10) is whoever is on the late shift when the
    // night starts: the one booked may have gone home ill since. With nobody, the bridge is dropped
    // and the late staff stay until relieved anyway (nobody leaves an uncovered floor).
    if (a.stayOn && !a.spawned && t >= a.arriveT && !onTheLate(world, a.personId)) {
      const day = dayIndex(a.startT);
      const other = [holder(world, day, "late.ca"), holder(world, day, "late.lead")].find((id) => id && onTheLate(world, id));
      if (other) a.personId = other;
      else {
        Object.assign(a, { spawned: true, started: true, ended: true });
        continue;
      }
    }
    const person = world.people.get(a.personId)!;
    if (!a.spawned && t >= a.arriveT) {
      a.spawned = true;
      person.staff!.shift = a;
      // Staying on from the late shift, or the main-building carer already here helping with
      // falls: already here and on duty.
      const alreadyHere = person.id === world.data.rota.main_building_carer.id && (person.onMap || world.spawnQueue.includes(person.id));
      if (!a.stayOn && !alreadyHere) {
        person.staff!.duty = "arriving";
        if (person.kind === "agency") emit(world, "agency.spawned", [person.id], { staffId: person.id, role: person.staff!.role === "agency_nurse" ? "nurse" : "carer", shift: a.shift });
        world.spawnQueue.push(person.id);
      }
    }
    if (a.spawned && !a.started && t >= a.startT) startShift(world, a, person);
    if (a.started && !a.ended && t >= a.endT) {
      a.ended = true;
      emit(world, "shift.ended", [person.id], { staffId: person.id, shift: a.shift, slot: a.slot });
      if (a.shift === "rn_day") {
        world.rnOnCall = true;
        emit(world, "rn.on_call_started", [], { nurseLabel: "On-call RN (main building)" });
      }
      if (person.staff!.shift !== a && person.staff!.shift?.stayOn) continue; // carrying on into the night
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
    if (!s || s.duty !== "staying") continue;
    if (s.taskId && world.tasks.get(s.taskId)?.kind === "idle") pullOff(world, p, "end of shift");
    if (s.taskId) continue;
    const handovers = [...world.tasks.values()].filter((t) => t.kind === "handover");
    // Still owed to a handover (as a member, or as its floor cover): stay until it's done.
    if (handovers.some((t) => (t.members!.includes(p.id) && !t.assigned.includes(p.id)) || t.data.cover === p.id)) continue;
    // A medication round they were giving and had to leave (for a fall): they finish it first.
    if ([...world.tasks.values()].some((t) => t.kind === "med_round" && t.members!.includes(p.id))) continue;
    // An open task only they can do (e.g. female-only care, and they're the last woman on shift).
    const onlyThem = [...world.tasks.values()].some(
      (t) => t.status === "open" && t.request && (!t.femaleOnly || p.gender === "female") && isCareStaff(p) && !coverableOnSite(world, t),
    );
    if (onlyThem) continue;
    // Covered by someone who isn't about to go into a handover.
    const inHandover = new Set(handovers.flatMap((t) => t.members!));
    if (isCareStaff(p) && !coveredWithout(world, p, false, inHandover, true)) continue;
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
    // An agency worker still ill with an infection stays known until they've recovered, so their
    // recovery is logged (an outbreak waits for it, docs/10).
    if (person?.kind === "agency" && !person.onMap && !(person.infection && !person.infection.recovered)) {
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
    if (person.id === PARAMEDICS_ID) {
      paramedicsArrived(world, person);
      continue;
    }
    if (person.id === ON_CALL_RN_ID) {
      onCallRnArrived(world, person);
      continue;
    }
    // The main-building carer sent for to help with falls (on a night shift he arrives like staff).
    if (person.id === world.data.rota.main_building_carer.id && world.mainCarer.status === "on_site" && !person.staff!.shift) {
      mainCarerArrived(world, person);
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
      if (person.id === ON_CALL_RN_ID) onCallRnDeparted(world, person);
      if (person.id === world.data.rota.main_building_carer.id && world.mainCarer.status !== "off") mainCarerDeparted(world, person);
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

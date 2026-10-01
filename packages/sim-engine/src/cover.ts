// Sick calls and no-shows (docs/10): a rostered worker won't be in, and the rota rule looks for
// cover. A free bank carer first (care assistant and night slots), then an agency worker (a nurse
// for the RN slot; for a lead's slot a meds-trained senior, always found), otherwise the shift
// runs short. At night a carer comes over from the main building, and the late carer stays on
// only until she arrives (1 to 2 hours); everyone else keeps 11 hours' rest.

import {
  SECONDS_PER_DAY,
  WEEKDAYS,
  clockToSeconds,
  dayIndex,
  type AbsenceReason,
  type CoverChoice,
  type ShiftName,
  type Source,
} from "@vch/shared-types";
import { emit } from "./emit.js";
import { addAgencyWorker, holder } from "./rota.js";
import { criticalWork, mainBuildingCarer } from "./falls.js";
import { comeIn } from "./float.js";
import { pullOff } from "./tasks.js";
import { walkTo } from "./world/movement.js";
import { isCareStaff, type Absence, type Person, type ShiftAssignment, type World } from "./state.js";

const REST_HOURS = 11;

/** Used when the director is off (a manual sick call): the manager always finds someone if anyone can come. */
const MANUAL = { bank_accept: 1, agency_available: 1, bank_travel_mins: [30, 60], agency_arrival_mins: [60, 120] } as const;

/** Applies `staff_sick`: their next shift that hasn't started is lost. Returns why it didn't apply, if it didn't. */
export function staffSick(world: World, staffId: string, cover: CoverChoice, source: Source): string | null {
  const a = nextShift(world, (s) => s.personId === staffId);
  if (!a) return world.shifts.some((s) => s.personId === staffId && !s.ended) ? "already at work" : "no shift to miss";
  markAbsent(world, a, "sick", cover, world.t, source);
  return null;
}

/** Applies `shift_no_show`: whoever holds the slot's next shift doesn't turn up. */
export function shiftNoShow(world: World, slot: string, cover: CoverChoice, source: Source): string | null {
  const a = nextShift(world, (s) => s.slot === slot);
  if (!a) return `no upcoming ${slot} shift`;
  markAbsent(world, a, "no_show", cover, Math.max(world.t, a.startT), source);
  return null;
}

/**
 * Someone off sick with an infection (docs/10) misses every planned shift that starts before
 * they're clear. Shifts are planned a day at a time, so this runs every minute (from infection.ts).
 */
export function excludeUpcoming(world: World, staffId: string, untilT: number): void {
  for (const a of world.shifts.filter((s) => s.personId === staffId && !s.started && !s.stayOn && s.startT < untilT)) {
    // Already on their way in or in the staff room: sent home before the shift starts.
    if (a.spawned) sendHomeArriving(world, world.people.get(staffId)!, a);
    else markAbsent(world, a, "sick", "auto", world.t, "engine");
  }
}

/** Someone with symptoms who has arrived for a shift that hasn't started: a sick call now, and home. */
function sendHomeArriving(world: World, p: Person, arriving: ShiftAssignment): void {
  if (p.staff!.shift === arriving) p.staff!.shift = null;
  const queued = world.spawnQueue.indexOf(p.id);
  if (queued >= 0) world.spawnQueue.splice(queued, 1);
  markAbsent(world, arriving, "went_home_sick", "auto", world.t, "engine");
  if (!p.onMap) p.staff!.duty = "off";
  else {
    p.staff!.duty = "leaving";
    p.task = null;
    walkTo(world, p, "ExitDoor");
  }
}

/**
 * Symptoms start at work: they go home. Their shift ends now (they leave once the floor is
 * covered, as anyone whose shift has ended does), and the rest of it is covered like a sick call.
 */
export function sendHomeSick(world: World, p: Person): void {
  // Arrived but not started yet (symptoms in the staff room before the shift): a sick call now, and home.
  const arriving = world.shifts.find((s) => s.personId === p.id && s.spawned && !s.started && !s.stayOn);
  if (arriving) return sendHomeArriving(world, p, arriving);
  const a = world.shifts.find((s) => s.personId === p.id && s.started && !s.ended);
  if (!a) return;
  // No more hands-on care: what they're doing goes back on the queue, unless it can't be left (a
  // two-person transfer under way, walking a resident), which they finish first.
  const doing = p.staff!.taskId ? world.tasks.get(p.staff!.taskId) : undefined;
  if (doing && !criticalWork(world, doing)) pullOff(world, p, "taken ill");
  // The lone night carer: the floating carer comes to cover the wing until the cover arrives.
  const others = world.order.map((id) => world.people.get(id)!).some((q) => q.id !== p.id && isCareStaff(q) && q.onMap && q.staff!.duty === "on_shift" && !!q.staff!.shift);
  if (!others && world.float.status === "off") {
    world.metrics.floatCallouts += 1;
    emit(world, "second_carer.called", [world.data.rota.night_float.id], { reason: "the night carer taken ill", residentIds: [], outOfRound: true });
    comeIn(world, false, world.rng.cover.int(8, 12));
  }
  const endT = a.endT;
  a.endT = world.t;
  const rest: ShiftAssignment = { ...a, arriveT: world.t, startT: world.t, endT, spawned: false, started: false, ended: false, stayOn: false };
  emit(world, "staff.absent", [p.id], { staffId: p.id, name: p.name, slot: a.slot, shift: a.shift, reason: "went_home_sick", shiftStartT: world.t });
  world.absences = world.absences.filter((x) => x.endT > world.t - SECONDS_PER_DAY);
  const absence: Absence = { staffId: p.id, name: p.name, slot: a.slot, shift: a.shift, reason: "went_home_sick", startT: world.t, endT, cover: null };
  world.absences.push(absence);
  // A late carer bridging the night until its cover arrives: that cover is already booked (for the
  // end of the bridge); the floating carer covers the gap (called out above). Nothing more to book.
  if (!a.stayOn && endT > world.t) bookCover(world, rest, absence, "auto", world.t);
  world.shifts.sort((x, y) => x.arriveT - y.arriveT || x.personId.localeCompare(y.personId));
}

function nextShift(world: World, match: (a: ShiftAssignment) => boolean): ShiftAssignment | undefined {
  return world.shifts.filter((a) => match(a) && !a.spawned && !a.stayOn).sort((a, b) => a.startT - b.startT)[0];
}

function markAbsent(world: World, a: ShiftAssignment, reason: AbsenceReason, choice: CoverChoice, bookT: number, source: Source): void {
  const person = world.people.get(a.personId)!;
  world.shifts.splice(world.shifts.indexOf(a), 1);
  emit(world, "staff.absent", [person.id], { staffId: person.id, name: person.name, slot: a.slot, shift: a.shift, reason, shiftStartT: a.startT }, source);
  // An agency worker who won't come is forgotten; one already here, or ill, is kept until they've gone (rota.ts pruneShifts).
  if (person.kind === "agency" && !person.onMap && !world.spawnQueue.includes(person.id) && !person.infection) {
    world.people.delete(person.id);
    world.order = world.order.filter((id) => id !== person.id);
  }
  world.absences = world.absences.filter((x) => x.endT > world.t - SECONDS_PER_DAY);
  const absence: Absence = { staffId: person.id, name: person.name, slot: a.slot, shift: a.shift, reason, startT: a.startT, endT: a.endT, cover: null };
  world.absences.push(absence);
  bookCover(world, a, absence, choice, bookT);
  world.shifts.sort((x, y) => x.arriveT - y.arriveT || x.personId.localeCompare(y.personId));
}

function bookCover(world: World, a: ShiftAssignment, absence: Absence, choice: CoverChoice, bookT: number): void {
  const rng = world.rng.cover;
  const tuning = world.director?.settings.config.absence ?? MANUAL;
  const nurse = a.shift === "rn_day";
  const lead = a.slot.endsWith(".lead");
  const add = (kind: "bank" | "agency", personId: string, arriveT: number) => {
    const startT = Math.max(a.startT, arriveT);
    world.shifts.push({ personId, shift: a.shift, slot: a.slot, arriveT, startT, endT: a.endT, spawned: false, started: false, ended: false });
    absence.cover = { kind, staffId: personId, name: world.people.get(personId)!.name, arriveT: startT };
    emit(world, "rota.cover_booked", [personId], { slot: a.slot, shift: a.shift, forStaffId: absence.staffId, cover: kind, staffId: personId, arriveT });
  };

  // 1. Bank: care assistant and night slots only (the bank carers aren't meds-trained).
  if (!nurse && !lead && (choice === "auto" || choice === "bank")) {
    for (const s of world.data.staff.filter((x) => x.employment === "bank" && x.id !== absence.staffId)) {
      if (!restedFor(world, s.id, a)) continue;
      if (choice === "auto" && !rng.chance(tuning.bank_accept)) continue;
      const [lo, hi] = tuning.bank_travel_mins;
      add("bank", s.id, Math.max(a.startT - 10 * 60, bookT + rng.int(lo, hi) * 60));
      return;
    }
  }
  // 2. Agency, booked now, arriving an hour or two later. A shift lead's slot is always filled
  //    (at short notice and a premium if need be): someone meds-trained must be on the wing.
  if (choice === "agency" || (choice === "auto" && (lead || rng.chance(tuning.agency_available)))) {
    const pool = nurse ? world.data.rota.agency_pool.nurse : world.data.rota.agency_pool.carer;
    const inUse = new Set([...world.people.values()].filter((p) => p.kind === "agency").map((p) => p.name));
    const free = pool.filter((w) => !inUse.has(w.name));
    const worker = rng.pick(free.length > 0 ? free : pool);
    const [lo, hi] = tuning.agency_arrival_mins;
    const arriveT = Math.max(a.startT - 10 * 60, bookT + rng.int(lo, hi) * 60);
    add("agency", addAgencyWorker(world, worker, nurse, lead).id, arriveT);
    return;
  }
  // 3. Nobody. At night the wing is never left to the floating carer alone: a carer comes over
  //    from the main building (1 to 2 hours), and the late carer stays on only until he arrives.
  if (a.shift === "night") {
    const day = dayIndex(a.startT);
    const late = holder(world, day, "late.ca") ?? holder(world, day, "late.lead");
    const lateShift = world.shifts.find((s) => s.personId === late && s.shift === "late" && dayIndex(s.startT) === day);
    const coverT = Math.max(a.startT, bookT) + rng.int(60, 120) * 60;
    if (late && lateShift && !lateShift.ended) {
      world.shifts.push({ personId: late, shift: "night", slot: a.slot, arriveT: a.startT, startT: a.startT, endT: coverT, spawned: false, started: false, ended: false, stayOn: true });
      emit(world, "rota.cover_booked", [late], { slot: a.slot, shift: a.shift, forStaffId: absence.staffId, cover: "stay_on", staffId: late, arriveT: a.startT, untilT: coverT });
      absence.bridgedBy = late;
    }
    // Otherwise (the night carer going home ill in the night) they stay until she's here: someone
    // whose shift has ended leaves only once the floor is covered.
    // Nikos, the main building's cover carer (if he's here helping with falls, he stays on).
    const cover = mainBuildingCarer(world);
    world.shifts.push({ personId: cover.id, shift: "night", slot: a.slot, arriveT: coverT, startT: coverT, endT: a.endT, spawned: false, started: false, ended: false });
    absence.cover = { kind: "main_building", staffId: cover.id, name: cover.name, arriveT: coverT };
    emit(world, "rota.cover_booked", [cover.id], { slot: a.slot, shift: a.shift, forStaffId: absence.staffId, cover: "main_building", staffId: cover.id, arriveT: coverT });
    return;
  }
  const reason = choice === "none" ? "no cover (scripted)" : choice === "bank" ? "no bank carer free" : "no bank or agency cover";
  emit(world, "rota.no_cover", [], { slot: a.slot, shift: a.shift, forStaffId: absence.staffId, reason });
}


/** Free for the shift with 11 hours' rest either side, against what's planned and the rota for the days around it. */
function restedFor(world: World, staffId: string, a: ShiftAssignment): boolean {
  const busy: [number, number][] = world.shifts.filter((s) => s.personId === staffId).map((s) => [s.startT, s.endT]);
  const day = dayIndex(a.startT);
  for (let d = day - 1; d <= day + 1; d++) {
    const rotaDay = world.data.rota.week[WEEKDAYS[((d % 7) + 7) % 7]!];
    const slots: [ShiftName, string[]][] = [
      ["early", [rotaDay.early.lead, rotaDay.early.ca]],
      ["late", [rotaDay.late.lead, rotaDay.late.ca]],
      ["night", [rotaDay.night.carer]],
      ["rn_day", [rotaDay.rn_day.nurse]],
    ];
    for (const [shift, who] of slots) {
      if (!who.includes(staffId)) continue;
      const times = world.data.rota.shifts[shift];
      const start = d * SECONDS_PER_DAY + clockToSeconds(times.start);
      let end = d * SECONDS_PER_DAY + clockToSeconds(times.end);
      if (end <= start) end += SECONDS_PER_DAY;
      busy.push([start, end]);
    }
  }
  const rest = REST_HOURS * 3600;
  return busy.every(([s, e]) => e + rest <= a.startT || a.endT + rest <= s);
}

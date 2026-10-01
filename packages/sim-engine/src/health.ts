// Illness, hospital, end of life and admissions (docs/10, sub-milestone c). Every number is in
// data/director.json `health`, with its source.
// - Illness: mild ones are looked after in the home (rest in their room, checks at least hourly, a
//   drink at every contact, a higher falls risk); severe ones get the GP, then an ambulance.
// - Hospital: a resident conveyed (a serious fall, or a severe illness) stays for a sourced time by
//   cause, then comes back to their own bed with their care profile changed by cause (slower
//   walking, a higher falls risk, personal care needing two staff), kept as overrides of their card
//   in this run and logged. Temporary ones are undone when they end.
// - End of life: a decline over some weeks (checks every 30 minutes, family visiting more and
//   later), the last days in bed on comfort care, and a death recorded quietly: the family told,
//   the room left empty. Off with `deaths: false` (the public demo).
// - Admissions: a new resident moves into an empty room some weeks after a death, from a reviewed
//   card in data/personas/admissions.json.

import { SECONDS_PER_DAY, type Furniture, type HospitalCause, type IllnessKind, type NamedPoint, type Resident, type Source, type WorldData } from "@vch/shared-types";
import { act, seq, until, type BtNode } from "./bt.js";
import { validateData } from "./data/validate.js";
import { emit } from "./emit.js";
import { callPoint, crewLeaves, crewOf } from "./falls.js";
import { addPerson } from "./rota.js";
import { residentPerson } from "./sim.js";
import { chairFor, isCareStaff, isNurse, type Person, type Task, type World } from "./state.js";
import { resetTask } from "./tasks.js";
import { newBtState } from "./bt.js";
import { joinRounds } from "./meds.js";
import { waitMins, type Ctx } from "./trees.js";
import { planVisitorWeek, visitorPerson } from "./visitors.js";
import { getIntoBed, placeAt, releaseStand, walkTo } from "./world/movement.js";

const HOUR = 3600;
const DAY = SECONDS_PER_DAY;
const FALLS_UP: Record<Resident["mobility"]["falls_risk"], Resident["mobility"]["falls_risk"]> = { low: "medium", medium: "high", high: "high" };

/** Deaths and end-of-life decline are on (off for the public demo). */
export function deathsOn(world: World): boolean {
  return world.deaths;
}

/** Someone to speak for the home: the RN on the wing, else a care worker on duty, else the on-call RN. */
function speaker(world: World): string {
  const here = world.order.map((id) => world.people.get(id)!).filter((p) => isCareStaff(p) && p.onMap && p.staff!.duty === "on_shift");
  return (here.find(isNurse) ?? here[0])?.id ?? "ext_oncall_rn";
}

function informFamily(world: World, r: Person, reason: string): void {
  const nok = r.resident!.data.care.next_of_kin;
  const by = speaker(world);
  emit(world, "family.informed", [r.id, ...(by.startsWith("ext_") ? [] : [by])], { residentId: r.id, visitorId: nok, staffId: by, reason });
}

// ---------------------------------------------------------------- hospital

/**
 * Leaves the wing for hospital (with the paramedics). The stay is drawn by cause from the tuning
 * file; without one (the director off), 3 to 10 days as before. Back between 11:00 and 16:00.
 */
export function leaveForHospital(world: World, r: Person, cause: HospitalCause, byTaskId: string | null = null): void {
  const res = r.resident!;
  // Taken from the floor (an ambulance already called for an illness, after a fall): the fall is over.
  if (res.fall) {
    const entry = world.fallLog.findLast((f) => f.residentId === r.id && f.endT === null);
    if (entry) entry.endT = world.t;
    world.points.delete(`Fall.${r.id}`);
    res.fall = null;
    r.badges = r.badges.filter((b) => b !== "alert");
  }
  releaseStand(world, r);
  // Leaves with the crew: logged as a departure so room occupancy stays right (docs/07).
  emit(world, "person.departed", [r.id], { pointId: res.data.room });
  Object.assign(r, { onMap: false, move: null, atPoint: null, roomId: null, posture: "in_bed", task: null });
  Object.assign(res, { away: "hospital", busyTaskId: null, hospitalCause: cause, illness: null, leftForHospitalT: world.t });
  const h = world.config?.health;
  const rng = h ? world.rng.health : world.rng.falls;
  const days = h ? rng.int(h.stay_days[cause][0], h.stay_days[cause][1]) : rng.int(3, 10);
  res.returnT = (Math.floor(world.t / DAY) + days) * DAY + rng.int(11 * 60, 16 * 60) * 60;
  // Everything else for them ends (the task taking them finishes itself), with anyone on it freed.
  closeTasksOf(world, r, "gone to hospital", (t) => t.id === byTaskId);
}

/** A resident's work ends when they leave (hospital, death): anyone doing it is freed for other work first. */
function closeTasksOf(world: World, r: Person, reason: string, keep: (t: Task) => boolean = () => false): void {
  for (const t of [...world.tasks.values()]) {
    if (t.residentId !== r.id || keep(t)) continue;
    if (t.assigned.length > 0) resetTask(world, t, reason);
    world.tasks.delete(t.id);
    // An ambulance called for it is called off; a crew already here goes back (falls.ts fallsMinute).
    world.paramedics = world.paramedics.filter((call) => call.taskId !== t.id);
  }
}

/** Back from hospital into their own bed; with the tuning file, their care changes by cause. */
function returnFromHospital(world: World, p: Person): void {
  const res = p.resident!;
  const cause = res.hospitalCause;
  const days = Math.round((world.t - (res.leftForHospitalT ?? world.t)) / DAY);
  Object.assign(res, { away: null, returnT: null, leftForHospitalT: null, asleep: false, busyTaskId: null, requestId: null, fall: null, drinkLeftT: null });
  Object.assign(res, { lastCheckedT: world.t, lastTurnedT: world.t, lastToiletT: world.t, lastMouthCareT: world.t, morningDone: true });
  p.onMap = true;
  p.badges = [];
  p.task = null;
  emit(world, "person.arrived", [p.id], { pointId: res.data.room });
  getIntoBed(world, p);
  emit(world, "resident.returned_from_hospital", [p.id], { residentId: p.id, daysAway: days, ...(cause ? { cause } : {}) });
  const h = world.config?.health;
  if (!h || !cause) return;
  res.recentReturnUntil = world.t + h.after_return.weeks * 7 * DAY;
  applyOverride(world, p, `back from hospital (${cause.replace(/_/g, " ")})`, h.after_return.changes[cause]);
  res.hospitalCause = null;
}

// ---------------------------------------------------------------- care-profile overrides

/** Changes their care profile for this run (their card is a copy in world.data), logged, undone at `weeks` (null: lasting). */
export function applyOverride(world: World, p: Person, reason: string, change: { walk_speed_factor?: number; falls_risk_up?: boolean; personal_care_staff?: number; weeks: number | null }): void {
  const res = p.resident!;
  const effect = {
    ...(change.walk_speed_factor !== undefined && p.speed > 0 ? { speedFactor: change.walk_speed_factor } : {}),
    ...(change.falls_risk_up ? { fallsUp: true } : {}),
    ...(change.personal_care_staff === 2 ? { twoStaff: true } : {}),
  };
  if (Object.keys(effect).length === 0) return;
  res.careBase ??= { speed: p.speed, fallsRisk: res.data.mobility.falls_risk, personalCareStaff: res.data.care.personal_care_staff };
  const untilT = change.weeks === null ? null : world.t + change.weeks * 7 * DAY;
  res.overrides.push({ reason, changes: [], untilT, ended: false, effect });
  // Kept even if an earlier change already did the same, so it still applies after that one ends.
  const changes = applyCareChanges(p);
  const logged = changes.length ? changes : ["no change now: an earlier change already applies"];
  res.overrides.at(-1)!.changes = logged;
  emit(world, "resident.care_changed", [p.id], { residentId: p.id, reason, changes: logged, untilT });
}

/** Sets walking speed, falls risk and staff for personal care from the base and every change still on; says what changed. */
function applyCareChanges(p: Person): string[] {
  const res = p.resident!;
  const base = res.careBase!;
  const on = res.overrides.filter((o) => !o.ended);
  const speed = Math.round(on.reduce((v, o) => v * (o.effect.speedFactor ?? 1), base.speed) * 1000) / 1000;
  let fallsRisk = base.fallsRisk;
  for (const o of on) if (o.effect.fallsUp) fallsRisk = FALLS_UP[fallsRisk];
  const twoStaff = on.some((o) => o.effect.twoStaff);
  const personalCareStaff = twoStaff ? 2 : base.personalCareStaff;
  const changes: string[] = [];
  if (speed !== p.speed) {
    changes.push(speed < p.speed ? `walks ${Math.round((1 - speed / p.speed) * 100)}% slower (${speed} m/s)` : `walks at ${speed} m/s again`);
    p.speed = speed;
  }
  if (fallsRisk !== res.data.mobility.falls_risk) {
    changes.push(`falls risk ${res.data.mobility.falls_risk} to ${fallsRisk}`);
    res.data.mobility.falls_risk = fallsRisk;
  }
  if (personalCareStaff !== res.data.care.personal_care_staff) {
    changes.push(personalCareStaff === 2 ? "personal care and transfers need two staff" : "personal care back to one member of staff");
    res.data.care.personal_care_staff = personalCareStaff;
  }
  return changes;
}

function expireOverrides(world: World, p: Person): void {
  const res = p.resident!;
  for (const o of res.overrides) {
    if (o.ended || o.untilT === null || world.t < o.untilT) continue;
    o.ended = true;
    // What's left is the base with the changes still on (another may be keeping the same thing up).
    const changes = applyCareChanges(p);
    emit(world, "resident.care_changed", [p.id], { residentId: p.id, reason: `${o.reason}: ended`, changes: changes.length ? changes : ["no change: another change still applies"], untilT: null });
  }
}

// ---------------------------------------------------------------- illness

/** Applies `resident_illness`. Returns why it didn't apply, if it didn't. */
export function startIllness(world: World, r: Person, kind: IllnessKind, severity: "mild" | "severe", source: Source): string | null {
  const h = world.config?.health;
  if (!h) return "no health settings (data/director.json) for this run";
  const res = r.resident;
  if (!res) return "not a resident";
  if (!r.onMap) return "not on the wing";
  if (res.illness) return "already ill";
  if (res.endOfLife) return "on end-of-life care";
  const rng = world.rng.health;
  const t = world.t;
  const checkMins = h.illness.check_interval_mins;
  if (severity === "mild") res.illness = { kind, severity, startT: t, endT: t + rng.int(h.illness.mild_days[0] * 24, h.illness.mild_days[1] * 24) * HOUR, gpT: null, checkMins };
  else {
    const gpT = t + rng.int(h.illness.gp_hours[0] * 60, h.illness.gp_hours[1] * 60) * 60;
    res.illness = { kind, severity, startT: t, endT: gpT, gpT, checkMins };
  }
  emit(world, "illness.started", [r.id], { residentId: r.id, kind, severity }, source);
  return null;
}

/** Waiting in their room for the ambulance; the paramedics assess them for 10 minutes, then take them. */
export const transferTree: BtNode<Ctx> = seq(
  "hospital transfer",
  until("the paramedics are with them", (c) => {
    const crew = crewOf(c.world, c.task.id);
    if (!crew?.onMap || crew.staff!.duty !== "on_shift") return false;
    // Wherever they are now: in their room, or on the floor after a fall while the crew was on its way.
    const where = callPoint(c.world, c.task);
    if (crew.atPoint !== where && crew.move?.destPointId !== where) walkTo(c.world, crew, where);
    return crew.atPoint === where && !crew.move;
  }),
  waitMins("paramedics assess them", () => 10),
  act("taken to hospital", (c) => {
    const { world, task } = c;
    const r = c.resident!;
    const cause = task.data.cause as HospitalCause;
    const crew = crewOf(world, task.id)!;
    emit(world, "resident.conveyed_to_hospital", [r.id, crew.id], { residentId: r.id, cause });
    informFamily(world, r, `taken to hospital (${cause.replace(/_/g, " ")})`);
    leaveForHospital(world, r, cause, task.id);
    crewLeaves(world, crew, task.id);
  }),
);

function callAmbulance(world: World, r: Person, cause: HospitalCause): void {
  world.taskSeq += 1;
  const task = {
    id: `t${String(world.taskSeq).padStart(6, "0")}`,
    kind: "hospital_transfer" as const,
    label: `Ambulance for ${r.name.split(" ")[0]}`,
    residentId: r.id,
    need: null,
    createdT: world.t,
    startedT: world.t,
    staffNeeded: 1 as const,
    femaleOnly: false,
    priority: 0,
    request: false,
    deadlineT: null,
    members: null,
    assigned: [],
    status: "active" as const,
    bt: newBtState(),
    data: { point: `${r.resident!.data.room}.Side`, cause },
  };
  world.tasks.set(task.id, task);
  world.paramedics.push({ taskId: task.id, dueT: world.t + world.rng.health.int(30, 90) * 60, crewId: null });
  emit(world, "ambulance.called", [r.id, ...(speaker(world).startsWith("ext_") ? [] : [speaker(world)])], { residentId: r.id, staffId: speaker(world), cause });
}

// ---------------------------------------------------------------- end of life

/** Applies `end_of_life_start`. */
export function startEndOfLife(world: World, r: Person, expectedDays: number, source: Source): string | null {
  const h = world.config?.health;
  if (!h) return "no health settings (data/director.json) for this run";
  if (!deathsOn(world)) return "deaths and end-of-life decline are off for this run";
  const res = r.resident;
  if (!res) return "not a resident";
  if (!r.onMap) return "not on the wing";
  if (res.endOfLife) return "already on end-of-life care";
  const deathT = world.t + expectedDays * DAY;
  res.endOfLife = { startT: world.t, deathT, finalFromT: Math.max(world.t, deathT - h.end_of_life.final_days * DAY), final: false, checkMins: h.end_of_life.check_interval_mins };
  res.illness = null;
  emit(world, "end_of_life.started", [r.id], { residentId: r.id, expectedDays }, source);
  return null;
}

/** The last days: in bed, comfort care (mouth care and sips), checks stepped up (every 30 minutes), turned 2-hourly. */
function lastDays(world: World, p: Person): void {
  const res = p.resident!;
  const h = world.config!.health.end_of_life;
  const care = res.data.care;
  if (!res.inBed) {
    if (res.busyTaskId || p.move) return; // after what they're doing
    releaseStand(world, p);
    getIntoBed(world, p);
  }
  res.endOfLife!.final = true;
  res.endOfLife!.checkMins = h.final_check_interval_mins;
  // In bed from now on, as on Dennis's card: pads changed in bed (turns include a change), and too
  // weak to use the call bell, so checks and turns look after them.
  Object.assign(care, { bed_bound: true, eating_support: "mouth_care_only", mouth_care_interval_mins: h.comfort_interval_mins, toileting: "in_bed", can_request_help: false });
  for (const t of world.tasks.values()) if (t.residentId === p.id && t.kind === "assist" && t.need === "toileting" && t.startedT === null) t.data.method = "bedside";
  // Settled and positioned in bed now: the 2-hourly turns start from here.
  if (!care.reposition_interval_mins.day) {
    care.reposition_interval_mins = { day: 120, night: 120 };
    res.lastTurnedT = world.t;
  }
  const changes = ["in bed", "pads changed in bed", `comfort care (mouth care and sips) every ${h.comfort_interval_mins} min`, `checks every ${h.final_check_interval_mins} min`, "turned every 2 hours"];
  res.overrides.push({ reason: "end of life: the last days", changes, untilT: null, ended: false, effect: {} });
  emit(world, "resident.care_changed", [p.id], { residentId: p.id, reason: "end of life: the last days", changes, untilT: null });
}

/** Recorded quietly: the family told, the room left empty for now. */
function die(world: World, p: Person): void {
  const res = p.resident!;
  const room = res.data.room.split(".")[0]!;
  emit(world, "resident.died", [p.id], { residentId: p.id, roomId: room });
  informFamily(world, p, "died peacefully");
  emit(world, "cqc.notification_flagged", [p.id], { residentId: p.id, regulation: "Registration Regulations 2009, Regulation 16", reason: "death of a person using the service" });
  releaseStand(world, p);
  emit(world, "person.departed", [p.id], { pointId: res.data.room });
  Object.assign(p, { onMap: false, move: null, atPoint: null, roomId: null, posture: "in_bed", task: null, badges: [] });
  Object.assign(res, { away: "died", busyTaskId: null, requestId: null, illness: null, fall: null });
  closeTasksOf(world, p, "died");
  // Some weeks later a new resident moves in, from the next reviewed card waiting.
  const d = world.director;
  const h = world.config!.health;
  const card = nextCard(world);
  if (d?.settings.random && card) {
    const [lo, hi] = h.admission_weeks_after_death;
    const day = Math.floor(world.t / DAY) + world.rng.health.int(lo * 7, hi * 7);
    const applyT = day * DAY + world.rng.health.int(13 * 60, 16 * 60) * 60;
    d.queue = [...d.queue, { applyT, type: "admission" as const, params: { cardId: card.id }, origin: "random" }].sort((a, b) => a.applyT - b.applyT);
    emit(world, "director.planned", [], { inputType: "admission", applyT, origin: "random", reason: "a room left empty", params: { cardId: card.id } }, "director");
  }
}

/** The next reviewed card nobody has moved in with yet (and not already booked). */
function nextCard(world: World) {
  const booked = new Set((world.director?.queue ?? []).filter((e) => e.type === "admission").map((e) => (e.params as { cardId: string }).cardId));
  return world.admissions.find((c) => c.status === "reviewed" && !world.people.has(c.resident.id) && !booked.has(c.id)) ?? null;
}

// ---------------------------------------------------------------- admissions

/** The bed points of rooms nobody living is in. */
function emptyBeds(world: World): string[] {
  const taken = new Set(world.order.map((id) => world.people.get(id)!.resident).filter((r) => r && r.away !== "died").map((r) => r!.data.room));
  return world.data.floorplan.points.filter((p) => p.kind === "bed" && !taken.has(p.id)).map((p) => p.id).sort();
}

/** Applies `admission`: a reviewed card moves into the first empty room, with their family. */
export function admit(world: World, cardId: string, source: Source): string | null {
  const card = world.admissions.find((c) => c.id === cardId);
  if (!card) return `no admission card "${cardId}"`;
  if (card.status !== "reviewed") return `card "${cardId}" hasn't been reviewed yet`;
  if (world.people.has(card.resident.id)) return "already moved in";
  const bed = emptyBeds(world)[0];
  if (!bed) return "no empty room";
  const resident: Resident = { ...structuredClone(card.resident), room: bed, admitted: `day ${Math.floor(world.t / DAY)}` };
  const visitors = structuredClone(card.visitors);
  const setUp = roomSetUpFor(world, resident);
  // Checked like any resident against the data as it is now; errors about people who have died
  // (their room is the one being reused) don't count.
  const dead = world.data.residents.filter((r) => world.people.get(r.id)!.resident!.away === "died").map((r) => r.id);
  const kept = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !setUp.remove.includes(x.id));
  const floorplan = {
    ...world.data.floorplan,
    points: [...kept(world.data.floorplan.points), ...setUp.add.map((a) => a.point)],
    furniture: [...kept(world.data.floorplan.furniture), ...setUp.add.flatMap((a) => (a.furniture ? [a.furniture] : []))],
  };
  const living = world.data.residents.filter((r) => !dead.includes(r.id));
  const check: WorldData = { ...world.data, floorplan, residents: [...living, resident], visitors: [...world.data.visitors, ...visitors] };
  const errors = validateData(check).filter((e) => !dead.some((id) => e.includes(id)));
  if (errors.length > 0) return `card "${cardId}" doesn't validate: ${errors[0]}`;
  // The room's bedside seating set up for them (logged with the admission).
  world.data.floorplan = floorplan;
  for (const id of setUp.remove) world.points.delete(id);
  for (const a of setUp.add) world.points.set(a.point.id, a.point);
  world.data.residents.push(resident);
  world.data.visitors.push(...visitors);

  const p = residentPerson(resident, world);
  const res = p.resident!;
  Object.assign(res, { asleep: false, inBed: false, lastCheckedT: world.t, lastToiletT: world.t, lastTurnedT: world.t, lastMouthCareT: world.t, morningDone: true, wokeT: world.t });
  p.badges = [];
  addPerson(world, p);
  world.shiftLog.set(p.id, { falls: 0, lateOrMissedDoses: 0, helpRequests: 0, checksDone: 0 });
  emit(world, "person.arrived", [p.id], { pointId: bed });
  if (resident.care.bed_bound) {
    p.x = world.points.get(bed)!.x;
    getIntoBed(world, p);
    res.inBed = true;
  } else {
    placeAt(world, p, chairFor(p));
    p.posture = "sitting";
  }
  p.onMap = true;
  joinRounds(world, p.id);
  emit(world, "resident.admitted", [p.id], { residentId: p.id, roomId: bed.split(".")[0]!, cardId }, source);
  for (const v of visitors) {
    const vp = visitorPerson(v);
    addPerson(world, vp);
  }
  for (const v of visitors) planVisitorWeek(world, world.people.get(v.id)!, Math.floor(world.t / DAY));
  return null;
}

/**
 * The room set up for the new resident's bedside seating (docs/02): a chair for someone who sits
 * out, a wheelchair spot for a hoisted wheelchair user, neither for someone bed-bound. What the
 * last resident had and the new one doesn't use goes (Raj's wheelchair spot leaves with him); what
 * they need is added at the same place by the bed as in the other rooms. Nothing added blocks walking.
 */
function roomSetUpFor(world: World, r: Resident): { add: { point: NamedPoint; furniture: Furniture | null }[]; remove: string[] } {
  const need = r.care.bed_bound ? null : r.care.transfer_method === "hoist" ? "wheelchair" : "chair";
  const ids = { chair: `${r.room}.Chair`, wheelchair: `${r.room}.Wheelchair` };
  const remove = [...(need !== "chair" ? [ids.chair, `${r.room}.chair`] : []), ...(need !== "wheelchair" ? [ids.wheelchair] : [])].filter(
    (id) => world.data.floorplan.points.some((p) => p.id === id) || world.data.floorplan.furniture.some((f) => f.id === id),
  );
  if (!need || world.points.has(ids[need])) return { add: [], remove };
  const suffix = need === "chair" ? ".Chair" : ".Wheelchair";
  const example = world.data.floorplan.points.find((p) => p.kind === need && p.id.endsWith(`.Bed${suffix}`) && p.id !== ids[need]);
  const exampleBed = example && world.points.get(example.id.slice(0, -suffix.length));
  const bed = world.points.get(r.room)!;
  if (!example || !exampleBed) return { add: [], remove };
  const x = bed.x + (example.x - exampleBed.x);
  const y = bed.y + (example.y - exampleBed.y);
  const point: NamedPoint = { id: ids[need], kind: need, room: bed.room, x, y };
  const furniture: Furniture | null = need === "chair" ? { id: `${r.room}.chair`, kind: "chair", room: bed.room, rect: { x: x - 0.25, y: y - 0.25, w: 0.5, h: 0.5 }, blocks: false, label: "Bedside chair" } : null;
  return { add: [{ point, furniture }], remove };
}

// ---------------------------------------------------------------- every minute

/** Once a minute: illnesses run their course, the GP sends severe ones to hospital, stays end, the end of life. */
export function healthMinute(world: World): void {
  for (const id of world.order) {
    const p = world.people.get(id)!;
    const res = p.resident;
    if (!res) continue;
    if (res.away === "hospital" && res.returnT !== null && world.t >= res.returnT) returnFromHospital(world, p);
    if (res.overrides.length) expireOverrides(world, p);
    if (!p.onMap) continue;
    const ill = res.illness;
    if (ill?.severity === "mild" && world.t >= ill.endT) {
      res.illness = null;
      emit(world, "illness.recovered", [p.id], { residentId: p.id, kind: ill.kind });
    }
    if (ill?.severity === "severe" && ill.gpT !== null && world.t >= ill.gpT && !res.fall) {
      ill.gpT = null;
      emit(world, "gp.consulted", [p.id], { residentId: p.id, kind: ill.kind, outcome: "admit" });
      callAmbulance(world, p, ill.kind);
    }
    const eol = res.endOfLife;
    if (eol && !eol.final && world.t >= eol.finalFromT) lastDays(world, p);
    if (eol && world.t >= eol.deathT && !res.busyTaskId) die(world, p);
  }
}

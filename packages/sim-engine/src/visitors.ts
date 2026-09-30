// Visitors (docs/05 "Visiting", spec decision 11). Visiting is open (CQC Regulation 9A). Each
// day at 00:00 every visitor is sampled from their pattern (listed days, arrival window,
// reliability) with the seeded `visitors` stream; companions only come with their lead visitor.
// A visitor arrives at the exit door, signs in with the receptionist (or rings the bell out of
// hours so a carer lets them in), goes to the resident, stays for the visit, signs out and
// leaves. Soft friction: during protected lunch, or while personal care is going on, visitors
// wait in the waiting area (someone who helps at meals, like Kuldip with Raj, may stay).
// No moods or conflicts yet (Phase 4).

import { SECONDS_PER_DAY, WEEKDAYS, clockToSeconds, dayIndex, timeOfDay, type Visitor } from "@vch/shared-types";
import { act, seq, type BtNode } from "./bt.js";
import { newBtState } from "./bt.js";
import { emit } from "./emit.js";
import { essentialVisit, outbreakOn } from "./infection.js";
import { initials } from "./rota.js";
import { onDuty, type Person, type World } from "./state.js";
import { goTo, waitMins, type Ctx } from "./trees.js";
import { depart, walkTo } from "./world/movement.js";

const PROTECTED_LUNCH = { from: clockToSeconds("12:15"), to: clockToSeconds("13:30") };
const SIGN_MINS = 1;
/** Personal care the visitor steps out for. */
const PRIVATE_CARE = new Set(["morning", "bedtime", "pad_change", "reposition"]);
const WAITING_SEATS = ["WaitingArea.Seat2", "WaitingArea.Seat3", "WaitingArea.Seat4", "WaitingArea.Seat5", "WaitingArea.Seat6", "WaitingArea.Seat7"];
/** Company: a visit settles the resident's social need over about half an hour. */
const SOCIAL_RELIEF_PER_MIN = 1 / 30;

export function visitorPerson(v: Visitor): Person {
  return {
    id: v.id,
    kind: "visitor",
    name: v.name,
    initials: initials(v.name),
    gender: v.gender,
    speed: v.walk_speed_mps,
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
    staff: null,
    resident: null,
    visitor: { data: v, residentId: v.relation_to_resident[0]!.resident, leadId: v.accompanies ?? null, phase: "home", arriveT: null, durationMins: 0, visitStartT: null, stepT: null, weekDays: [] },
    infection: null,
  };
}

function visitorsOf(world: World): Person[] {
  return world.order.map((id) => world.people.get(id)!).filter((p) => p.visitor);
}

/**
 * The weekly quota: each lead visitor visits a set number of their pattern days a week,
 * `floor(reliability × days)` plus one more with the leftover fraction as its probability (so
 * Linda, 0.85 × 5 = 4.25, comes 4 days, sometimes 5; Gary, 0.04 × 1, comes in about 1 week in
 * 25). Which days is chosen with the seeded `visitors` stream. At the start of a run only the
 * days left in that week count. Phase 3's director can cancel a visitor's week with a cause.
 */
export function planWeek(world: World, fromDay: number): void {
  for (const p of visitorsOf(world).sort((a, b) => a.id.localeCompare(b.id))) planVisitorWeek(world, p, fromDay);
}

/** One lead visitor's days this week (also for the family of a resident who moves in mid-week). */
export function planVisitorWeek(world: World, p: Person, fromDay: number): void {
  const rng = world.rng.visitors;
  const monday = fromDay - (fromDay % 7);
  const v = p.visitor!;
  if (v.leadId) return; // companions come when their lead does
  const pattern = v.data.visit_pattern;
  const days = pattern.days.map((d) => monday + WEEKDAYS.indexOf(d)).sort((a, b) => a - b);
  const exact = pattern.reliability * days.length;
  const quota = Math.floor(exact) + (rng.next() < exact - Math.floor(exact) ? 1 : 0);
  // Pick `quota` of the pattern days (a seeded shuffle), then keep those not already past.
  const shuffled = [...days];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  v.weekDays = shuffled.slice(0, quota).filter((d) => d >= fromDay).sort((a, b) => a - b);
}

/** Plans today's visits from the weekly quota. Leads first, so companions can see whether their lead is coming. */
export function planVisits(world: World, day: number, fromT: number): void {
  const weekday = WEEKDAYS[day % 7]!;
  const rng = world.rng.visitors;
  const people = visitorsOf(world).sort((a, b) => Number(!!a.visitor!.leadId) - Number(!!b.visitor!.leadId) || a.id.localeCompare(b.id));
  for (const p of people) {
    const v = p.visitor!;
    const pattern = v.data.visit_pattern;
    const resident = world.people.get(v.residentId)!.resident!;
    if (resident.away === "died") continue; // their family no longer visits
    // At the end of their life (docs/10) the family comes every day, later and for longer.
    const endOfLife = !!resident.endOfLife;
    if (endOfLife && !v.leadId && v.phase === "home") {
      if (rng.next() >= Math.min(0.95, pattern.reliability + 0.5)) continue;
      const [from, to] = pattern.time_window.split("-").map(clockToSeconds) as [number, number];
      const later = Math.min(from + 2 * 3600, 18 * 3600);
      const arriveT = day * SECONDS_PER_DAY + later + rng.int(0, Math.max(0, (Math.min(to + 3 * 3600, 20 * 3600) - later) / 60)) * 60;
      const durationMins = Math.round(pattern.duration_mins * 1.5 * (0.8 + rng.next() * 0.4));
      if (arriveT < fromT) continue;
      Object.assign(v, { phase: "outside", arriveT, durationMins, visitStartT: null, stepT: null });
      emit(world, "visit.planned", [p.id, v.residentId], { visitorId: p.id, residentId: v.residentId, arriveT, durationMins });
      continue;
    }
    if (!pattern.days.includes(weekday) || v.phase !== "home") continue;
    // Leads visit on their quota days; a companion comes along with the given probability.
    if (v.leadId ? rng.next() >= pattern.reliability : !v.weekDays.includes(day)) continue;
    let arriveT: number;
    let durationMins: number;
    if (v.leadId) {
      const lead = world.people.get(v.leadId)!.visitor!;
      if (lead.phase !== "outside" || lead.arriveT === null || dayIndex(lead.arriveT) !== day) continue;
      arriveT = lead.arriveT;
      durationMins = lead.durationMins;
    } else {
      const [from, to] = pattern.time_window.split("-").map(clockToSeconds) as [number, number];
      arriveT = day * SECONDS_PER_DAY + from + rng.int(0, (to - from) / 60) * 60;
      durationMins = Math.round(pattern.duration_mins * (0.8 + rng.next() * 0.4));
    }
    if (arriveT < fromT) continue;
    Object.assign(v, { phase: "outside", arriveT, durationMins, visitStartT: null, stepT: null });
    emit(world, "visit.planned", [p.id, v.residentId], { visitorId: p.id, residentId: v.residentId, arriveT, durationMins });
  }
}

function receptionist(world: World): Person | null {
  const p = world.order.map((id) => world.people.get(id)!).find((s) => s.staff?.role === "receptionist" && onDuty(s) && s.atPoint === "Reception.DeskStaff" && !s.staff.taskId);
  return p ?? null;
}

function companions(world: World, lead: Person): Person[] {
  return visitorsOf(world).filter((p) => p.visitor!.leadId === lead.id && p.visitor!.phase !== "home");
}

/** Anyone who has to wait before going to the resident, and why. */
function mustWait(world: World, visitor: Person): boolean {
  const r = world.people.get(visitor.visitor!.residentId)!;
  const res = r.resident!;
  if (res.fall) return true;
  const tod = timeOfDay(world.t);
  const helper = visitor.visitor!.data.may_help_at_meals || (visitor.visitor!.leadId && world.people.get(visitor.visitor!.leadId)!.visitor!.data.may_help_at_meals);
  if (tod >= PROTECTED_LUNCH.from && tod < PROTECTED_LUNCH.to && !helper) return true;
  const busy = res.busyTaskId ? world.tasks.get(res.busyTaskId) : undefined;
  if (busy && ((busy.kind === "care" && PRIVATE_CARE.has(String(busy.data.care))) || (busy.kind === "assist" && busy.need === "toileting"))) return true;
  return false;
}

function spotBy(world: World, visitor: Person): string {
  const r = world.people.get(visitor.visitor!.residentId)!;
  if (r.resident!.inBed || !r.atPoint || r.atPoint === r.resident!.data.room) return `${r.resident!.data.room}.Side2`;
  return r.atPoint;
}

function goHome(world: World, p: Person): void {
  p.visitor!.phase = "leaving";
  p.task = null;
  walkTo(world, p, "ExitDoor");
}

/** The bell out of hours: a carer goes to reception and lets them in. */
function ringBell(world: World, lead: Person, group: Person[]): void {
  for (const p of group) p.visitor!.phase = "at_door";
  emit(world, "visitor.rang_bell", [lead.id], { visitorId: lead.id });
  world.taskSeq += 1;
  const task = {
    id: `t${String(world.taskSeq).padStart(6, "0")}`,
    kind: "let_in" as const,
    label: "Answer the door",
    residentId: null,
    need: null,
    createdT: world.t,
    startedT: null,
    staffNeeded: 1 as const,
    femaleOnly: false,
    priority: 80,
    request: false,
    deadlineT: null,
    members: null,
    assigned: [],
    status: "open" as const,
    bt: newBtState(),
    data: { visitors: group.map((p) => p.id) },
  };
  world.tasks.set(task.id, task);
  emit(world, "task.created", [lead.id], { taskId: task.id, kind: "let_in", residentId: null, dueT: world.t });
}

export const letInTree: BtNode<Ctx> = seq(
  "let_in",
  goTo("go to the door", (c) => c.staff, () => ["Reception.Desk"]),
  act("open up", (c) => (c.task.startedT = c.world.t)),
  waitMins("let them in and sign the book", () => SIGN_MINS),
  act("signed in", (c) => {
    const staffId = c.staff[0]!.id;
    for (const id of c.task.data.visitors as string[]) {
      const p = c.world.people.get(id)!;
      emit(c.world, "visitor.let_in", [id, staffId], { visitorId: id, staffId });
      emit(c.world, "visitor.signed_in", [id, staffId], { visitorId: id, staffId });
      p.visitor!.phase = "entering";
      p.visitor!.stepT = -1; // already signed in
      c.world.spawnQueue.push(id);
    }
  }),
);

/** Runs each minute: arrivals, waiting and the end of visits. */
export function visitorsMinute(world: World): void {
  const t = world.t;
  if (timeOfDay(t) === 0) {
    if (dayIndex(t) % 7 === 0) planWeek(world, dayIndex(t));
    planVisits(world, dayIndex(t), t);
  }

  for (const p of visitorsOf(world)) {
    const v = p.visitor!;
    const r = world.people.get(v.residentId)!;
    // Nobody comes (or stays) to see a resident who isn't here.
    if (!r.onMap && v.phase !== "home" && v.phase !== "leaving") {
      if (p.onMap) goHome(world, p);
      else v.phase = "home";
      continue;
    }
    // During an outbreak only essential visits go ahead (a resident at the end of their life):
    // visits not yet started are cancelled, and anyone here finishes and goes (docs/10).
    if (outbreakOn(world) && !essentialVisit(r) && v.phase !== "home" && v.phase !== "leaving") {
      if (p.onMap) {
        if (v.visitStartT !== null) emit(world, "visit.ended", [p.id, v.residentId], { visitorId: p.id, residentId: v.residentId });
        goHome(world, p);
      } else {
        const queued = world.spawnQueue.indexOf(p.id);
        if (queued >= 0) world.spawnQueue.splice(queued, 1);
        v.phase = "home";
        emit(world, "visit.cancelled", [p.id, r.id], { visitorId: p.id, residentId: r.id, reason: "outbreak: essential visits only" });
      }
      continue;
    }
    if (v.phase === "outside" && v.leadId === null && t >= v.arriveT!) {
      const group = [p, ...companions(world, p)];
      if (receptionist(world)) {
        for (const q of group) {
          q.visitor!.phase = "entering";
          q.visitor!.stepT = null;
          world.spawnQueue.push(q.id);
        }
      } else ringBell(world, p, group);
    }
    if (v.phase === "waiting" && !mustWait(world, p)) {
      v.phase = "to_resident";
      walkTo(world, p, spotBy(world, p));
    }
    if (v.phase === "visiting") {
      const res = r.resident!;
      res.needs.social = Math.max(0, res.needs.social - SOCIAL_RELIEF_PER_MIN);
      // They sit with the resident wherever they are: if the resident has moved (to or from the
      // Lounge), the visitor follows once they've settled.
      const spot = spotBy(world, p);
      if (!r.move && !res.busyTaskId && !p.move && p.atPoint !== spot) walkTo(world, p, spot);
      if (mustWait(world, p)) {
        v.phase = "waiting";
        walkTo(world, p, WAITING_SEATS[(v.data.id.length + world.order.indexOf(p.id)) % WAITING_SEATS.length]!);
      }
    }
    // The lead's visit ends; companions go with them.
    if (v.leadId === null && v.visitStartT !== null && (v.phase === "visiting" || v.phase === "waiting") && t >= v.visitStartT + v.durationMins * 60) {
      for (const q of [p, ...companions(world, p)]) {
        if (q.visitor!.visitStartT !== null) emit(world, "visit.ended", [q.id, v.residentId], { visitorId: q.id, residentId: v.residentId });
        q.visitor!.phase = "signing_out";
        q.visitor!.stepT = null;
        q.task = null;
        walkTo(world, q, "Reception.Desk");
      }
    }
  }
}

/** Runs every tick: reacts to visitors arriving where they were going. */
export function visitorsTick(world: World, spawned: string[], arrived: string[]): void {
  for (const id of spawned) {
    const p = world.people.get(id)!;
    if (!p.visitor) continue;
    if (p.visitor.stepT === -1) {
      p.visitor.phase = "to_resident";
      p.visitor.stepT = null;
      if (mustWait(world, p)) {
        p.visitor.phase = "waiting";
        walkTo(world, p, WAITING_SEATS[world.order.indexOf(p.id) % WAITING_SEATS.length]!);
      } else walkTo(world, p, spotBy(world, p));
    } else {
      p.visitor.phase = "signing_in";
      walkTo(world, p, "Reception.Desk");
    }
  }
  for (const p of visitorsOf(world)) {
    const v = p.visitor!;
    if (!p.onMap || p.move) continue;
    if (v.phase === "signing_in") {
      if (v.stepT === null) v.stepT = world.t;
      if (world.t - v.stepT < SIGN_MINS * 60) continue;
      const desk = receptionist(world);
      emit(world, "visitor.signed_in", [p.id, ...(desk ? [desk.id] : [])], { visitorId: p.id, staffId: desk?.id ?? "visitors_book" });
      v.stepT = null;
      if (mustWait(world, p)) {
        v.phase = "waiting";
        walkTo(world, p, WAITING_SEATS[world.order.indexOf(p.id) % WAITING_SEATS.length]!);
      } else {
        v.phase = "to_resident";
        walkTo(world, p, spotBy(world, p));
      }
    } else if (v.phase === "to_resident" && arrived.includes(p.id)) {
      v.phase = "visiting";
      p.task = `Visiting ${world.people.get(v.residentId)!.name.split(" ")[0]}`;
      if (v.visitStartT === null) {
        v.visitStartT = world.t;
        emit(world, "visit.started", [p.id, v.residentId], { visitorId: p.id, residentId: v.residentId, pointId: p.atPoint ?? "" });
      }
    } else if (v.phase === "signing_out") {
      if (v.stepT === null) v.stepT = world.t;
      if (world.t - v.stepT < SIGN_MINS * 60) continue;
      emit(world, "visitor.signed_out", [p.id], { visitorId: p.id });
      goHome(world, p);
    } else if (v.phase === "leaving" && p.atPoint === "ExitDoor") {
      depart(world, p);
      v.phase = "home";
    }
  }
}

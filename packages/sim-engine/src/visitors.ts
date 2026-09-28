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
    visitor: { data: v, residentId: v.relation_to_resident[0]!.resident, leadId: v.accompanies ?? null, phase: "home", arriveT: null, durationMins: 0, visitStartT: null, stepT: null },
  };
}

function visitorsOf(world: World): Person[] {
  return world.order.map((id) => world.people.get(id)!).filter((p) => p.visitor);
}

/** Samples today's visits. Leads first, so companions can check whether their lead is coming. */
export function planVisits(world: World, day: number, fromT: number): void {
  const weekday = WEEKDAYS[day % 7]!;
  const rng = world.rng.visitors;
  const people = visitorsOf(world).sort((a, b) => Number(!!a.visitor!.leadId) - Number(!!b.visitor!.leadId) || a.id.localeCompare(b.id));
  for (const p of people) {
    const v = p.visitor!;
    const pattern = v.data.visit_pattern;
    if (!pattern.days.includes(weekday)) continue;
    const roll = rng.next();
    if (v.phase !== "home" || roll >= pattern.reliability) continue;
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
  if (timeOfDay(t) === 0) planVisits(world, dayIndex(t), t);

  for (const p of visitorsOf(world)) {
    const v = p.visitor!;
    const r = world.people.get(v.residentId)!;
    // Nobody comes (or stays) to see a resident who isn't here.
    if (!r.onMap && v.phase !== "home" && v.phase !== "leaving") {
      if (p.onMap) goHome(world, p);
      else v.phase = "home";
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

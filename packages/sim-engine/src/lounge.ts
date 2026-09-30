// The Lounge routine (docs/05 "The Lounge"). Residents who can walk there (Peggy, Win, Arthur,
// Stan; see each card's `care.lounge`) spend part of the day in the residents' Lounge:
// - on Bev's days, her music and reminiscence session from 10:45 to 11:45;
// - lunch at the dining table for those who choose it;
// - an afternoon there (TV, reading, puzzles or chatting, from their likes), dozing in an armchair
//   at nap time, until 14:45, or 16:00 for those who stay for afternoon tea.
// Peggy and Stan are walked there and back by a carer; Win and Arthur go alone. Raj and Dennis
// stay in their room for now. Sitting near another resident meets some social need. While Peggy
// or Stan is there, a carer is in the Lounge or looks in at least every 15 minutes (the
// lounge_supervision service target). Runs once per sim minute, from careMinute.

import { clockToSeconds, timeOfDay, type LoungeActivity } from "@vch/shared-types";
import { emit } from "./emit.js";
import { chairFor, isCareStaff, onDuty, type Person, type World } from "./state.js";
import { createCare, createLoungeCheck, createSelfMove } from "./tasks.js";
import { isIsolated, outbreakOn } from "./infection.js";
import { walkTo } from "./world/movement.js";

export const LOUNGE = "Lounge";
const at = clockToSeconds;
const TIMES = {
  sessionGo: at("10:40"),
  sessionFrom: at("10:45"),
  sessionUntil: at("11:45"),
  lunchGo: at("11:50"),
  lunchUntil: at("13:30"),
  afternoonFrom: at("13:30"),
  noTeaUntil: at("14:45"),
  teaUntil: at("16:00"),
};
const SESSION = "Music and reminiscence";
/** Seats move to an armchair this long before a nap, so they doze in comfort. */
const NAP_LEAD_MINS = 10;
const NAP_MINS = 45;
/** Company: another awake resident this close. */
const COMPANY_METRES = 3;
const SOCIAL_PER_MIN = 1 / 40;
/** A carer looks in on the Lounge this long after the last one was there (target: 15 minutes). */
const LOOK_IN_AFTER_MINS = 5;
export const SUPERVISION_MINS = 15;

const LABEL: Record<LoungeActivity | "lunch" | "session", string> = {
  tv: "Watching TV",
  reading: "Reading",
  puzzles: "Doing puzzles",
  chatting: "Chatting",
  lunch: "Lunch in the Lounge",
  session: `${SESSION} with Bev`,
};

function seats(world: World, prefix: string): string[] {
  return [...world.points.values()].filter((p) => p.room === LOUNGE && p.id.startsWith(prefix)).map((p) => p.id).sort();
}

const armchairs = (world: World) => [...seats(world, "Lounge.Armchair"), "Lounge.Reading"];

/** Needs someone in the Lounge with them (the supervision target): residents who are walked there. */
export function needsSupervision(p: Person): boolean {
  return !!p.resident?.data.care.lounge?.escort;
}

/** Bev (the activities coordinator) is on shift today, so her session runs. */
function activitiesCoordinator(world: World): Person | null {
  for (const id of world.order) {
    const p = world.people.get(id)!;
    if (p.staff?.role === "activities_coordinator" && onDuty(p) && p.staff.shift?.started) return p;
  }
  return null;
}

type Want = "room" | "dining" | "activity" | "doze";

/** Where the Lounge routine wants a resident right now, or null to leave them be. */
function wanted(world: World, p: Person, sessionDay: boolean): Want | null {
  const res = p.resident!;
  const prefs = res.data.care.lounge;
  if (!prefs) return null;
  // Isolated with an infection, or the Lounge closed for an outbreak (docs/10): they stay in their room.
  if (isIsolated(p) || outbreakOn(world)) return "room";
  const tod = timeOfDay(world.t);
  const session = sessionDay && tod >= TIMES.sessionGo && tod < TIMES.sessionUntil;
  const lunch = prefs.lunch && tod >= (sessionDay ? TIMES.sessionUntil : TIMES.lunchGo) && tod < TIMES.lunchUntil;
  const afternoon = tod >= TIMES.afternoonFrom && tod < (prefs.tea ? TIMES.teaUntil : TIMES.noTeaUntil);
  if (!session && !lunch && !afternoon) return tod >= TIMES.sessionGo && tod < at("18:00") ? "room" : null;
  if (lunch && !res.mealsServed.includes("lunch")) return "dining";
  const nap = res.data.routine.nap ? clockToSeconds(res.data.routine.nap) : null;
  if (nap !== null && tod >= nap - NAP_LEAD_MINS * 60 && tod < nap + NAP_MINS * 60) return "doze";
  return "activity";
}

/** Seats nobody is in, walking to, or being taken to (a carer sitting with a resident included). */
export function freeSeats(world: World, ids: string[]): string[] {
  const taken = new Set<string>();
  for (const q of world.people.values()) {
    if (!q.onMap) continue;
    if ((q.resident || q.posture === "sitting") && q.atPoint) taken.add(q.atPoint);
    if (q.resident && q.move) taken.add(q.move.destPointId);
  }
  for (const t of world.tasks.values()) {
    if (t.data.to) taken.add(String(t.data.to));
    if (t.kind === "idle" && t.data.activity === "sit_with") taken.add(String(t.data.point));
  }
  return ids.filter((id) => !taken.has(id));
}

/** Every seat in the Lounge. */
export function loungeSeats(world: World): string[] {
  return [...world.points.values()].filter((p) => p.room === LOUNGE && p.kind === "seat").map((p) => p.id).sort();
}

/**
 * Free Lounge seats beyond what the residents who use the Lounge could still need (everyone with a
 * Lounge routine who isn't already sitting there). A carer may take a Lounge seat only while this is
 * at least 1, so the residents always have seats.
 */
export function loungeSeatsSpare(world: World): number {
  const all = loungeSeats(world);
  const seated = new Set(all);
  let mayNeed = 0;
  for (const q of world.people.values()) if (q.resident?.data.care.lounge && !(q.atPoint && seated.has(q.atPoint) && !q.move)) mayNeed += 1;
  return freeSeats(world, all).length - mayNeed;
}

function nearestFree(world: World, ids: string[], to: { x: number; y: number }): string | null {
  const free = freeSeats(world, ids);
  free.sort((a, b) => {
    const pa = world.points.get(a)!;
    const pb = world.points.get(b)!;
    return Math.hypot(pa.x - to.x, pa.y - to.y) - Math.hypot(pb.x - to.x, pb.y - to.y) || a.localeCompare(b);
  });
  return free[0] ?? null;
}

/** Other awake residents in the Lounge. */
function company(world: World, p: Person): Person[] {
  return world.order.map((id) => world.people.get(id)!).filter((q) => q.id !== p.id && q.resident && q.onMap && q.roomId === LOUNGE && !q.resident.asleep);
}

/** A seat for an activity: an armchair for TV, the reading chair, the activity table, or next to someone for a chat. */
function seatFor(world: World, p: Person, activity: LoungeActivity): string | null {
  const here = { x: p.x, y: p.y };
  if (activity === "tv") return nearestFree(world, seats(world, "Lounge.Armchair"), here);
  if (activity === "reading") return freeSeats(world, ["Lounge.Reading"])[0] ?? null;
  if (activity === "puzzles") return nearestFree(world, seats(world, "Lounge.Activity"), here);
  const others = company(world, p);
  if (others.length === 0) return null;
  // Already sitting close enough for a chat: stay put.
  if (p.roomId === LOUNGE && p.atPoint && others.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= COMPANY_METRES)) return p.atPoint;
  const all = [...seats(world, "Lounge.Dining"), ...armchairs(world), ...seats(world, "Lounge.Activity")];
  return nearestFree(world, all, { x: others[0]!.x, y: others[0]!.y });
}

/** Picks what to do from their likes (the first liked most), and a seat for it. */
function chooseActivity(world: World, p: Person): { activity: LoungeActivity; seat: string } | null {
  const likes = p.resident!.data.care.lounge!.likes;
  const weights = likes.map((_, i) => likes.length - i);
  let roll = world.rng.decisions.next() * weights.reduce((a, b) => a + b, 0);
  let first = 0;
  for (let i = 0; i < likes.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) {
      first = i;
      break;
    }
  }
  for (const activity of [likes[first]!, ...likes.filter((_, i) => i !== first)]) {
    const seat = seatFor(world, p, activity);
    if (seat) return { activity, seat };
  }
  return null;
}

/** On their way to or from the Lounge (walked by a carer, or on their own). */
function tripPending(world: World, p: Person): boolean {
  for (const t of world.tasks.values()) if (t.residentId === p.id && (t.kind === "self_move" || (t.kind === "care" && t.data.care === "escort"))) return true;
  return false;
}

function free(world: World, p: Person): boolean {
  const res = p.resident!;
  if (!p.onMap || res.asleep || res.busyTaskId || res.fall || res.inBed || p.move || !res.morningDone) return false;
  return !tripPending(world, p);
}

/** Walks them there, e.g. "to the Lounge for lunch": with a carer (Peggy, Stan) or on their own (Win, Arthur). */
function trip(world: World, p: Person, to: string, where: string): void {
  if (p.resident!.data.care.lounge!.escort) createCare(world, p, "escort", { to, fullLabel: `Walk ${p.name.split(" ")[0]} ${where}` });
  else createSelfMove(world, p, to, `Going ${where}`);
}

function setActivity(p: Person, activity: LoungeActivity | null, label: string | null): void {
  p.resident!.loungeActivity = activity;
  if (!p.resident!.busyTaskId) p.task = label;
}

/** The armchairs face the TV; the reading chair is by the bookshelf. */
const armchairActivity = (seat: string): LoungeActivity => (seat === "Lounge.Reading" ? "reading" : "tv");

function routine(world: World, p: Person, sessionDay: boolean): void {
  const res = p.resident!;
  const inLounge = p.roomId === LOUNGE;
  // The activity is chosen when they set off, and kept until they're back out of the Lounge.
  if (!inLounge && res.loungeActivity && !tripPending(world, p)) setActivity(p, null, null);
  if (inLounge && res.loungeActivity && !res.busyTaskId) p.task = LABEL[res.loungeActivity];
  const want = wanted(world, p, sessionDay);
  if (!want || !free(world, p)) return;
  if (want === "room") {
    if (inLounge) {
      setActivity(p, null, null);
      trip(world, p, chairFor(p), "back to their room");
    }
    return;
  }
  const into = inLounge ? "across the Lounge" : "to the Lounge";
  const here = { x: p.x, y: p.y };
  if (want === "dining") {
    if (p.atPoint?.startsWith("Lounge.Dining")) return setActivity(p, null, LABEL.lunch);
    const seat = nearestFree(world, seats(world, "Lounge.Dining"), here);
    if (seat) {
      res.loungeActivity = null;
      trip(world, p, seat, `${into} for lunch`);
    }
    return;
  }
  if (want === "doze") {
    if (p.atPoint && armchairs(world).includes(p.atPoint)) {
      if (!res.loungeActivity) setActivity(p, armchairActivity(p.atPoint), LABEL[armchairActivity(p.atPoint)]);
      return;
    }
    const seat = nearestFree(world, armchairs(world), here);
    if (seat) {
      res.loungeActivity = armchairActivity(seat);
      trip(world, p, seat, `${into} to an armchair`);
    }
    return;
  }
  // An activity (Bev's session they join wherever they sit).
  if (inLounge && res.loungeActivity) return;
  const choice = chooseActivity(world, p);
  if (!choice) {
    // Nothing they like is free: an armchair by the TV, if there's one.
    const seat = inLounge ? null : nearestFree(world, seats(world, "Lounge.Armchair"), here);
    if (seat) {
      res.loungeActivity = "tv";
      trip(world, p, seat, into);
    }
    return;
  }
  if (inLounge && p.atPoint === choice.seat) return setActivity(p, choice.activity, LABEL[choice.activity]);
  res.loungeActivity = choice.activity;
  trip(world, p, choice.seat, `${into} (${LABEL[choice.activity].toLowerCase()})`);
}

/** Bev's session: starts at 10:45 on her days, ends at 11:45; everyone awake in the Lounge joins. */
function session(world: World, residents: Person[]): void {
  const tod = timeOfDay(world.t);
  const bev = activitiesCoordinator(world);
  const here = residents.filter((p) => p.onMap && p.roomId === LOUNGE && !p.resident!.asleep).map((p) => p.id);
  if (!world.session && bev && tod === TIMES.sessionFrom && !outbreakOn(world)) {
    walkTo(world, bev, "Lounge.Post");
    world.session = { staffId: bev.id, activity: SESSION, residentIds: [...here], endT: world.t - tod + TIMES.sessionUntil };
    emit(world, "activity.started", [bev.id, ...here], { staffId: bev.id, activity: SESSION, roomId: LOUNGE, residentIds: here });
  }
  const s = world.session;
  if (!s) return;
  for (const id of here) if (!s.residentIds.includes(id)) s.residentIds.push(id);
  for (const id of here) {
    const p = world.people.get(id)!;
    if (!p.resident!.busyTaskId) p.task = LABEL.session;
  }
  if (world.t >= s.endT || !bev) {
    const ids = [...s.residentIds].sort();
    emit(world, "activity.ended", [s.staffId, ...ids], { staffId: s.staffId, activity: s.activity, roomId: LOUNGE, residentIds: ids });
    world.session = null;
  }
}

/** Company in the Lounge: sitting near another awake resident, more so chatting or in Bev's session. */
function companyEffects(world: World, residents: Person[]): void {
  for (const p of residents) {
    const res = p.resident!;
    if (!p.onMap || p.roomId !== LOUNGE || res.asleep) continue;
    const near = company(world, p).some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= COMPANY_METRES);
    const inSession = !!world.session?.residentIds.includes(p.id);
    if (!near && !inSession) continue;
    const rate = SOCIAL_PER_MIN * (res.loungeActivity === "chatting" ? 2 : 1) * (inSession ? 2 : 1);
    res.needs.social = Math.max(0, res.needs.social - rate);
  }
}

/** Every tick: a care worker on duty in the Lounge counts as the Lounge being supervised. */
export function noteLoungeSupervision(world: World): void {
  for (const id of world.order) {
    const p = world.people.get(id)!;
    if (p.onMap && p.roomId === LOUNGE && isCareStaff(p) && onDuty(p)) {
      world.loungeSeenT = world.t;
      return;
    }
  }
}

/** Residents in the Lounge who need someone keeping an eye on them (Peggy, Stan), not counting anyone a carer is with right now. */
export function supervisedResidents(world: World): Person[] {
  return world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap && p.roomId === LOUNGE && needsSupervision(p) && !withStaff(world, p));
}

/** Being walked or cared for by staff: supervised by them. */
function withStaff(world: World, p: Person): boolean {
  const task = p.resident!.busyTaskId ? world.tasks.get(p.resident!.busyTaskId) : undefined;
  return !!task && task.assigned.length > 0;
}

export function loungeMinute(world: World, residents: Person[]): void {
  const sessionDay = !!activitiesCoordinator(world);
  for (const p of residents) routine(world, p, sessionDay);
  session(world, residents);
  companyEffects(world, residents);
  // Nobody has been in for a while and Peggy or Stan is there: someone looks in.
  const open = [...world.tasks.values()].some((t) => t.kind === "lounge_check");
  if (!open && supervisedResidents(world).length > 0 && world.t - world.loungeSeenT >= LOOK_IN_AFTER_MINS * 60) {
    createLoungeCheck(world, world.loungeSeenT + SUPERVISION_MINS * 60);
  }
}

// The care schedule (docs/05 "Daily routine", "Procedures"): morning and bedtime care, meals,
// drinks rounds, Peggy's prompted toileting, checks at each resident's interval and daytime
// turns. Runs once per sim minute; night turns and pad changes come with the floating carer's
// rounds (float.ts).

import { clockToSeconds, timeOfDay, type DrinkRound, type MealName } from "@vch/shared-types";
import { checkInterval, isNight } from "./nightcover.js";
import { onBreak } from "./floor.js";
import { isCareStaff, onDuty, type Person, type World } from "./state.js";
import { createAssist, createCare, createDrinksRound, hasCare } from "./tasks.js";

const MEALS: { meal: MealName; from: string; until: string }[] = [
  { meal: "breakfast", from: "08:00", until: "10:30" },
  { meal: "lunch", from: "12:15", until: "13:30" },
  { meal: "supper", from: "17:30", until: "18:45" },
];
const DRINKS_ROUNDS: { round: DrinkRound; at: string }[] = [
  { round: "mid_morning", at: "10:30" },
  { round: "afternoon_tea", at: "15:00" },
  { round: "late_drink", at: "20:00" },
];
const DAY_RESET = clockToSeconds("04:00");
/**
 * Rounds before the two handovers that change who is on the floor at night: whoever is on duty
 * checks anyone who would otherwise fall due during the handover and the busy spell after it.
 */
const HANDOVER_ROUNDS = [
  { at: clockToSeconds("06:40"), coversUntil: clockToSeconds("08:00"), dueBy: clockToSeconds("07:00") },
  { at: clockToSeconds("20:55"), coversUntil: clockToSeconds("22:15"), dueBy: clockToSeconds("21:15") },
];
const DEFAULT_WAKE = "07:30";
/** Checks are created this long before they are due, so someone can get there in time. */
const CHECK_LEAD_MINS = 30;
const TURN_LEAD_MINS = 10;

function openTask(world: World, residentId: string): boolean {
  for (const t of world.tasks.values()) if (t.residentId === residentId && (t.kind === "assist" || t.kind === "self_toilet")) return true;
  return false;
}

function inRange(tod: number, from: string, until: string): boolean {
  return tod >= clockToSeconds(from) && tod < clockToSeconds(until);
}

function scheduleResident(world: World, p: Person): void {
  const res = p.resident!;
  const r = res.data;
  const tod = timeOfDay(world.t);

  // Morning personal care, from the resident's wake time. Night staff get early risers up only
  // if one person can do it; two-person morning care waits for the day shift at 07:00.
  const wake = clockToSeconds(r.routine.wake ?? DEFAULT_WAKE);
  const from = r.care.personal_care_staff === 2 ? Math.max(wake, clockToSeconds("07:00")) : wake;
  if (!res.morningDone && tod >= from && tod < clockToSeconds("12:00") && !hasCare(world, p.id, "morning")) {
    createCare(world, p, "morning");
  }

  // Meals, once the resident is up (Dennis gets mouth care and sips in bed).
  const ready = res.morningDone || r.care.bed_bound;
  for (const m of MEALS) {
    if (ready && inRange(tod, m.from, m.until) && !res.mealsServed.includes(m.meal) && !hasCare(world, p.id, "meal")) {
      createCare(world, p, "meal", { meal: m.meal });
    }
  }

  // Bedtime care from the resident's bed time (until 04:00).
  if (r.routine.bed && res.morningDone && !res.bedtimeDone && !res.inBed && (tod >= clockToSeconds(r.routine.bed) || tod < DAY_RESET) && !hasCare(world, p.id, "bedtime")) {
    createCare(world, p, "bedtime");
  }

  // Prompted toileting (Peggy): every few hours while awake.
  const prompt = r.care.prompted_toileting_hours;
  if (prompt && !res.asleep && world.t - res.lastToiletT >= prompt * 3600 && !openTask(world, p.id) && !res.busyTaskId) {
    createAssist(world, p, "toileting", false);
  }

  // Checks at the care-plan interval; any care with the resident counts as a check.
  const interval = checkInterval(res);
  const due = res.lastCheckedT + interval * 60;
  const dayStart = world.t - tod;
  const round = HANDOVER_ROUNDS.find((h) => h.at === tod && due < dayStart + h.coversUntil);
  // Created ahead of time, but never more than halfway through the interval (post-fall checks are every 30 minutes).
  const lead = Math.min(CHECK_LEAD_MINS, interval / 2);
  if ((world.t >= due - lead * 60 || round) && !res.busyTaskId && !hasCare(world, p.id, "check")) {
    createCare(world, p, "check", { dueT: round ? Math.min(due, dayStart + round.dueBy) : due });
  }

  // Daytime turns (Dennis); night turns are on the floating carer's rounds.
  const turnEvery = r.care.reposition_interval_mins.day;
  if (turnEvery && !isNight(world.t) && world.t >= res.lastTurnedT + (turnEvery - TURN_LEAD_MINS) * 60 && !hasCare(world, p.id, "reposition")) {
    createCare(world, p, "reposition", { dueT: res.lastTurnedT + turnEvery * 60 });
  }
}

/** A carer working in the same room within this distance can see the resident. */
const OBSERVE_METRES = 6;

/**
 * By day, observation counts as a check: a carer at work nearby in the same room sees the
 * resident (docs/05 "Checks"). Silent. At night, and always for bed-bound residents (Dennis),
 * only a bedside check counts.
 */
function observe(world: World, residents: Person[]): void {
  if (isNight(world.t)) return;
  const carers = world.order.map((id) => world.people.get(id)!).filter((s) => isCareStaff(s) && onDuty(s) && !s.move && !onBreak(world, s));
  for (const r of residents) {
    if (r.resident!.data.care.bed_bound) continue;
    if (carers.some((s) => s.roomId === r.roomId && Math.hypot(s.x - r.x, s.y - r.y) <= OBSERVE_METRES)) r.resident!.lastCheckedT = world.t;
  }
}

export function careMinute(world: World): void {
  const tod = timeOfDay(world.t);
  const residents = world.order.map((id) => world.people.get(id)!).filter((p) => p.resident && p.onMap);
  if (tod === DAY_RESET) {
    for (const p of residents) Object.assign(p.resident!, { morningDone: false, bedtimeDone: false, mealsServed: [] });
  }
  for (const d of DRINKS_ROUNDS) {
    if (tod === clockToSeconds(d.at)) {
      const byBed = [...residents].sort((a, b) => a.resident!.data.room.localeCompare(b.resident!.data.room));
      createDrinksRound(world, d.round, byBed.map((p) => p.id));
    }
  }
  observe(world, residents);
  for (const p of residents) scheduleResident(world, p);
}

// The care schedule (docs/05 "Daily routine", "Procedures"): tea on waking, morning and bedtime
// care, meals, drinks rounds, Peggy's prompted toileting, checks at each resident's interval,
// daytime turns, Dennis's comfort care and the Lounge routine (lounge.ts). Runs once per sim
// minute; night turns and pad changes come with the floating carer's rounds (float.ts).

import { tuned } from "./tuning.js";
import { clockToSeconds, timeOfDay, type DrinkRound, type MealName } from "@vch/shared-types";
import { checkInterval, isNight } from "./nightcover.js";
import { onBreak } from "./floor.js";
import { loungeMinute } from "./lounge.js";
import { noAppetite } from "./needs.js";
import { isCareStaff, onDuty, type Person, type World } from "./state.js";
import { createAssist, createCare, createDrinksRound, hasCare, morningCareWaitMins } from "./tasks.js";
import { emit } from "./emit.js";

const MEALS: { meal: MealName; from: string; until: string }[] = [
  { meal: "breakfast", from: "07:30", until: "10:30" },
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
/** Dennis's morning wash, after the 08:00 round (user decision, 2026-09-29). */
const BED_BOUND_WASH = clockToSeconds("08:30");
/** Checks are created this long before they are due, so someone can get there in time. */
const CHECK_LEAD_MINS = 30;
/** Day turns are scheduled this far ahead: before the 25-minute "pressing" window (tasks.ts), so nobody starts a long job just before one. */
const TURN_LEAD_MINS = 30;
/** Tea on waking should reach them within this long. */
const TEA_WITHIN_MINS = 15;
/** Awake this long without morning care: tea and toast before 07:30, breakfast first after it. */
const EARLY_RISER_MINS = 30;
const TEA_UNTIL = clockToSeconds("11:00");
const BREAKFAST_FROM = clockToSeconds("07:30");
/** Comfort care (mouth care and sips) is scheduled this close to falling due, if no check or turn has done it. */
const COMFORT_LEAD_MINS = 10;

/**
 * Turns the floating carer covers: due from 21:30 (after the late shift's handover) until the
 * morning rush has settled at 08:00.
 */
export const FLOAT_TURNS = { from: clockToSeconds("21:30"), until: clockToSeconds("08:00") };
/** Evening crunch: Raj's bedtime and the drinks round at 20:00, the 21:00 med round, the 21:15 handover. */
const EVENING_CRUNCH = { from: clockToSeconds("20:00"), until: FLOAT_TURNS.from };
/** A turn due in the crunch is brought forward to here, before Raj's bedtime and the drinks round. */
const EVENING_TURN = clockToSeconds("19:45");

/** When a turn due at `due` is done by day staff, or null if the floating carer's rounds cover it. */
export function dayTurnTime(world: World, due: number): number | null {
  const tod = timeOfDay(due);
  if (tod >= FLOAT_TURNS.from || tod < FLOAT_TURNS.until) return null;
  if (tuned(world, "evening_crunch") && tod >= EVENING_CRUNCH.from) return due - tod + EVENING_TURN;
  return due;
}

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
  // Bed-bound residents on comfort care (Dennis) have no wake time: their wash is timed to comfort,
  // after the 08:00 medication round.
  const wake = r.care.bed_bound ? BED_BOUND_WASH : clockToSeconds(r.routine.wake ?? DEFAULT_WAKE);
  const from = r.care.personal_care_staff === 2 ? Math.max(wake, clockToSeconds("07:00")) : wake;
  if (!res.morningDone && tod >= from && tod < clockToSeconds("12:00") && !hasCare(world, p.id, "morning")) {
    createCare(world, p, "morning");
  }

  // Tea on waking, its own short visit; early risers still waiting for care get toast too.
  const woke = res.wokeT;
  const awakeMins = woke === null ? 0 : (world.t - woke) / 60;
  const careUnderway = res.morningDone || [...world.tasks.values()].some((t) => t.residentId === p.id && t.kind === "care" && t.data.care === "morning" && t.status !== "open");
  if (!noAppetite(r) && woke !== null && !res.asleep && tod < TEA_UNTIL && !res.mealsServed.includes("breakfast")) {
    const tea = [...world.tasks.values()].find((t) => t.residentId === p.id && t.kind === "care" && t.data.care === "tea");
    const early = awakeMins >= EARLY_RISER_MINS && !careUnderway && !res.toastDone && tod < BREAKFAST_FROM;
    if (!res.teaDone && !tea) createCare(world, p, "tea", { dueT: woke + TEA_WITHIN_MINS * 60, label: "Tea" });
    else if (early && tea && tea.status === "open") Object.assign(tea, { label: `Tea and toast for ${p.name.split(" ")[0]}`, data: { ...tea.data, toast: 1 } });
    else if (early && !tea) createCare(world, p, "tea", { dueT: world.t + TEA_WITHIN_MINS * 60, toast: true, label: "Toast" });
  }

  // Meals, once the resident is up. Breakfast from 07:30 doesn't wait for morning care: if their
  // care is more than 30 minutes away, breakfast comes first, in bed or at the chair. Dennis has
  // no meals (comfort care instead).
  const careAway = !res.morningDone && !careUnderway && woke !== null && !res.asleep && morningCareWaitMins(world, p.id) > EARLY_RISER_MINS;
  for (const m of MEALS) {
    if (noAppetite(r)) break;
    const ready = res.morningDone || (m.meal === "breakfast" && careAway);
    if (ready && inRange(tod, m.from, m.until) && !res.mealsServed.includes(m.meal) && !hasCare(world, p.id, "meal")) {
      createCare(world, p, "meal", { meal: m.meal, first: !res.morningDone });
    }
  }

  // End-of-life comfort care: mouth care and sips at least every interval (checks and turns
  // usually do it; this is the fallback).
  const comfortEvery = r.care.mouth_care_interval_mins;
  if (comfortEvery) {
    const due = res.lastMouthCareT + comfortEvery * 60;
    const open = [...world.tasks.values()].find((t) => t.residentId === p.id && t.kind === "care" && t.data.care === "comfort");
    if (!open && world.t >= due - COMFORT_LEAD_MINS * 60) createCare(world, p, "comfort", { dueT: due });
    else if (open && open.status === "open" && due - world.t > 2 * COMFORT_LEAD_MINS * 60) {
      // A check or turn got there first.
      world.tasks.delete(open.id);
      emit(world, "task.interrupted", [p.id], { taskId: open.id, kind: "care.comfort", reason: "done at a check or turn" });
    }
  }

  // Bedtime care from the resident's bed time (until 04:00).
  if (r.routine.bed && res.morningDone && !res.bedtimeDone && !res.inBed && (tod >= clockToSeconds(r.routine.bed) || tod < DAY_RESET) && !hasCare(world, p.id, "bedtime")) {
    createCare(world, p, "bedtime");
  }

  // Prompted toileting (Peggy): every few hours while awake.
  const prompt = r.care.prompted_toileting_hours;
  // Not while morning care (which includes the toilet) is still to come.
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

  // Daytime turns (Dennis), from when each is due; the floating carer's rounds cover the night.
  const turnEvery = r.care.reposition_interval_mins.day;
  if (turnEvery && res.inBed && !hasCare(world, p.id, "reposition")) {
    const at = dayTurnTime(world, res.lastTurnedT + turnEvery * 60);
    const lead = tuned(world, "pressing_turns") ? TURN_LEAD_MINS : 20; // before the tuning rule: 20
    if (at !== null && world.t >= at - lead * 60) createCare(world, p, "reposition", { dueT: at });
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
    for (const p of residents) Object.assign(p.resident!, { morningDone: false, bedtimeDone: false, mealsServed: [], wokeT: null, teaDone: false, toastDone: false });
  }
  for (const d of DRINKS_ROUNDS) {
    if (tod === clockToSeconds(d.at)) {
      const byBed = [...residents].sort((a, b) => a.resident!.data.room.localeCompare(b.resident!.data.room));
      createDrinksRound(world, d.round, byBed.map((p) => p.id));
    }
  }
  observe(world, residents);
  for (const p of residents) scheduleResident(world, p);
  loungeMinute(world, residents);
}

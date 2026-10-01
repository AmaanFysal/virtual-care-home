// Behaviour trees for every task kind (docs/04 "Behaviour trees", docs/05 "Procedures").

import { TICK_SECONDS, type Badge, type DrinkOutcome, type DrinkRound, type MealName, type NeedName } from "@vch/shared-types";
import { act, leaf, sel, seq, until, type BtNode } from "./bt.js";
import { emit } from "./emit.js";
import { needsHelpToDrink } from "./needs.js";
import { chairFor, onDuty, type CareKind, type Person, type Task, type World } from "./state.js";
import { onFloor } from "./floor.js";
import { isNight } from "./nightcover.js";
import { absorbInto, createBriefing, finish } from "./tasks.js";
import { getIntoBed, getOutOfBed, placeAt, routeLeft, walkAlong, walkTo } from "./world/movement.js";
import { ppeMins } from "./infection.js";

export interface Ctx {
  world: World;
  task: Task;
  staff: Person[];
  resident: Person | null;
}

const NEED_BADGE: Record<NeedName, Badge> = { hunger: "tray", thirst: "cup", toileting: "towel", fatigue: "towel", social: "cup" };
/** Minutes at the bedside for each need (in-bed toileting is a pad change). */
const NEED_MINUTES: Record<NeedName, number> = { hunger: 5, thirst: 3, toileting: 15, fatigue: 5, social: 10 };
const STAFF_ROOM_SEATS = ["StaffRoom.Seat1", "StaffRoom.Seat2", "StaffRoom.Seat3", "StaffRoom.Seat4", "StaffRoom.Seat5", "StaffRoom.Seat6"];
/** Residents whose food and fluid intake is charted (docs/05 "Meal service"; Dennis's sips at mouth care). */
const CHARTED = new Set(["res_peggy", "res_win", "res_dennis"]);

// ---------------------------------------------------------------- helpers

export function waitMins(name: string, mins: (ctx: Ctx) => number): BtNode<Ctx> {
  return leaf(name, (ctx, mem) => {
    if (mem.start === undefined) mem.start = ctx.world.t;
    return ctx.world.t - mem.start! >= mins(ctx) * 60 ? "success" : "running";
  });
}

/** Sends each person to their point once, then runs until all have arrived. */
export function goTo(name: string, who: (ctx: Ctx) => Person[], points: (ctx: Ctx) => string[]): BtNode<Ctx> {
  return leaf(name, (ctx) => {
    const people = who(ctx);
    const targets = points(ctx);
    let moving = false;
    people.forEach((p, i) => {
      const target = targets[Math.min(i, targets.length - 1)]!;
      if (p.atPoint !== target) {
        if (!p.move || p.move.destPointId !== target) {
          if (!walkTo(ctx.world, p, target)) return; // unreachable: treat as arrived
        }
        moving = true;
      }
    });
    return moving ? "running" : "success";
  });
}

/**
 * Walks a resident somewhere with their carers beside them: like `goTo` for the resident and then
 * the staff, but the staff keep to the resident's pace instead of going on ahead (an escort).
 */
export function walkWith(name: string, points: (ctx: Ctx) => string[]): BtNode<Ctx> {
  return leaf(name, (ctx) => {
    const r = ctx.resident!;
    const targets = points(ctx);
    let moving = false;
    [r, ...ctx.staff].forEach((p, i) => {
      const target = targets[Math.min(i, targets.length - 1)]!;
      if (p.atPoint === target) return;
      if (!p.move || p.move.destPointId !== target) {
        // Carers take the resident's route (set first), then step to their own spot.
        if (!(p === r ? walkTo(ctx.world, p, target) : walkAlong(ctx.world, p, target, r))) return; // unreachable: treat as arrived
      }
      if (p !== r && p.move && r.speed > 0) Object.assign(p.move, { pace: besidePace(p, r), with: r.id, tether: BESIDE_M });
      moving = true;
    });
    // Each keeps within reach of the other: neither walks on while the other is held at a door.
    const carer = [...ctx.staff].sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y))[0];
    if (r.move && carer) Object.assign(r.move, { with: carer.id, tether: BESIDE_M });
    return moving ? "running" : "success";
  });
}

/** How far a carer walking with a resident may get from them before waiting (or catching up). */
const BESIDE_M = 1.5;

/**
 * A carer's pace beside a resident: the resident's pace; if they've drawn ahead (the resident held at
 * a door, or slower round a corner), they wait; if behind, they catch up at their own speed. Never
 * stopped in a doorway, which would block the resident.
 */
function besidePace(p: Person, r: Person): number {
  const together = Math.min(p.speed, r.speed);
  if (Math.hypot(p.x - r.x, p.y - r.y) <= BESIDE_M || p.heldZone || !r.move) return together;
  // Behind: catch up within a tick (5 s) without overshooting.
  const gap = Math.hypot(p.x - r.x, p.y - r.y);
  return routeLeft(p) <= routeLeft(r) ? 0 : Math.min(p.speed, together + Math.max(0, gap - 0.5) / TICK_SECONDS);
}

export function setBadges(people: Person[], badges: Badge[], label: string | null): void {
  for (const p of people) {
    p.badges = [...p.badges.filter((b) => b === "asleep"), ...badges];
    if (p.staff) p.task = label;
  }
}

export function bedsides(resident: Person): string[] {
  const bed = resident.resident!.data.room;
  return [`${bed}.Side`, `${bed}.Side2`];
}

/** Where staff stand to be with a resident: their bedsides if in bed, otherwise next to them. */
export function besideThem(resident: Person): string[] {
  const res = resident.resident!;
  if (res.inBed || !resident.atPoint || resident.atPoint === res.data.room) return bedsides(resident);
  return [resident.atPoint, resident.atPoint];
}

function wcFor(resident: Person): string {
  return `${resident.resident!.data.room.split(".")[0]}.WC`;
}

export { chairFor } from "./state.js";

export function lower(res: Person, need: NeedName, by: number): void {
  const needs = res.resident!.needs;
  needs[need] = Math.max(0, needs[need] - by);
}

/** How close a carer must be for a bedside check. */
export const BEDSIDE_M = 1.5;

/** At night, and always for bed-bound residents (Dennis), only a bedside check counts (docs/05 "Checks"). */
export function bedsideOnly(world: World, resident: Person): boolean {
  return isNight(world.t) || resident.resident!.data.care.bed_bound;
}

/**
 * Staff have been with the resident. An explicit check, or any care where bedside checks are
 * required, is logged as `resident.checked`; daytime care for others counts silently. Where a
 * bedside check is required, it only counts if a carer is within BEDSIDE_M.
 */
export function markChecked(world: World, resident: Person, staff: Person[], explicit: boolean, topUp = true): void {
  const res = resident.resident!;
  lower(resident, "social", 0.15); // any contact helps a little
  if (topUp) topUpDrink(world, resident, staff);
  const strict = bedsideOnly(world, resident);
  const near = staff.find((s) => Math.hypot(s.x - resident.x, s.y - resident.y) <= BEDSIDE_M);
  if (strict && !near) return;
  if (explicit || strict) {
    const by = (near ?? staff[0])!;
    emit(world, "resident.checked", [resident.id, by.id], { residentId: resident.id, staffId: by.id, sinceLastMins: Math.round((world.t - res.lastCheckedT) / 60), via: explicit ? "check" : "care" });
    world.shiftLog.get(resident.id)!.checksDone += 1;
  }
  res.lastCheckedT = world.t;
}

/**
 * Contact replaces a missed or stale drink (docs/05 "Drinks"): an owed drink is given while
 * they're awake; a stale one is drunk now, or a fresh one left if they're asleep.
 */
function topUpDrink(world: World, resident: Person, staff: Person[]): void {
  const res = resident.resident!;
  // Ill (docs/10): fluids pushed, a drink at every contact while they're awake.
  if (!res.drinkOwed && !res.drinkStale && !(res.illness && !res.asleep)) return;
  let outcome: DrinkOutcome | null = null;
  if (!res.asleep) {
    lower(resident, "thirst", 0.5);
    res.fluidsMlToday += 150;
    Object.assign(res, { drinkOwed: false, drinkStale: false, drinkLeftT: null });
    outcome = "drunk";
  } else if (res.drinkStale && !needsHelpToDrink(res.data)) {
    Object.assign(res, { drinkStale: false, drinkLeftT: world.t });
    outcome = "left";
  }
  if (outcome) emit(world, "drink.served", [resident.id, staff[0]!.id], { residentId: resident.id, round: "top_up", staffId: staff[0]!.id, outcome });
}

/** Any drink given in person settles an owed or stale one. */
function drank(res: Person): void {
  Object.assign(res.resident!, { drinkOwed: false, drinkStale: false });
}

function toileted(world: World, resident: Person): void {
  resident.resident!.needs.toileting = 0.05;
  resident.resident!.lastToiletT = world.t;
}

export function begin(c: Ctx, badges: Badge[]): void {
  c.task.startedT = c.world.t;
  emit(c.world, "task.started", c.task.residentId ? [...c.task.assigned, c.task.residentId] : c.task.assigned, { taskId: c.task.id, kind: c.task.kind });
  setBadges(c.staff, badges, c.task.label);
  if (c.task.staffNeeded === 2) c.task.data.phase = "performing";
}

// ---------------------------------------------------------------- assist (help requests, prompts)

function relieve(c: Ctx): void {
  const r = c.resident!;
  const need = c.task.need!;
  const relief: Record<NeedName, number> = { hunger: 0.5, thirst: 0.7, toileting: 1, fatigue: 0.3, social: 0.5 };
  if (need === "toileting") toileted(c.world, r);
  else lower(r, need, relief[need]);
  if (need === "thirst") r.resident!.fluidsMlToday += 200;
}

function methodIs(method: string): BtNode<Ctx> {
  return leaf(`method is ${method}?`, (c) => (c.task.data.method === method ? "success" : "failure"));
}

function returnPoint(c: Ctx): string {
  const to = String(c.task.data.returnTo);
  return to === "bed" ? `${c.resident!.resident!.data.room}.Side` : to;
}

const assistTree: BtNode<Ctx> = seq(
  "assist",
  goTo("go to resident", (c) => c.staff, (c) => besideThem(c.resident!)),
  act("begin", (c) => {
    begin(c, [c.task.staffNeeded === 2 ? "hoist" : NEED_BADGE[c.task.need!]]);
    markChecked(c.world, c.resident!, c.staff, false); // seen as soon as someone is at the bedside
  }),
  sel(
    "method",
    seq(
      "escort to the WC",
      methodIs("escort"),
      act("set off", (c) => {
        const r = c.resident!;
        c.task.data.returnTo = r.resident!.inBed ? "bed" : (r.atPoint ?? chairFor(r));
        if (r.resident!.inBed) getOutOfBed(c.world, r);
        walkTo(c.world, r, wcFor(r));
      }),
      walkWith("walk with them", (c) => [wcFor(c.resident!)]),
      waitMins("at the WC", () => 5),
      act("done at the WC", relieve),
      // Back to bed (carers at the bedsides) or to where they were sitting (carers beside them).
      walkWith("walk back", (c) => (c.task.data.returnTo === "bed" ? [returnPoint(c), ...bedsides(c.resident!)] : [returnPoint(c)])),
      act("settle", (c) => {
        if (c.task.data.returnTo === "bed") getIntoBed(c.world, c.resident!);
      }),
    ),
    seq(
      "at the bedside",
      waitMins("care", (c) => NEED_MINUTES[c.task.need!] + ppeMins(c.world, c.resident)),
      act("done", (c) => {
        relieve(c);
        c.task.data.phase = null;
      }),
    ),
  ),
);

// ---------------------------------------------------------------- scheduled care

function careKind(c: Ctx): CareKind {
  return c.task.data.care as CareKind;
}

function careMinutes(c: Ctx): number {
  const r = c.resident!.resident!.data;
  switch (careKind(c)) {
    case "morning":
      return r.care.personal_care_mins;
    case "bedtime":
      return r.care.personal_care_staff === 2 ? 20 : 15;
    case "check":
      return r.care.eating_support === "mouth_care_only" ? 3 : 1;
    case "reposition":
      return 10;
    case "pad_change":
      return 10;
    case "tea":
      return r.care.eating_support === "assisted" ? 5 : 2;
    case "comfort":
      return 5;
    case "escort":
      return 0;
    case "meal": {
      // A visitor who helps at meals (Kuldip with Raj) takes over the feeding; staff just bring the tray.
      const helper = [...c.world.people.values()].some((p) => p.visitor?.data.may_help_at_meals && p.visitor.residentId === c.resident!.id && p.visitor.phase === "visiting");
      if (helper) return 2;
      return { independent: 2, prompting: 5, assisted: 15, mouth_care_only: 5 }[r.care.eating_support];
    }
  }
}

function careBadge(c: Ctx): Badge[] {
  switch (careKind(c)) {
    case "meal":
      return ["tray"];
    case "tea":
    case "comfort":
      return ["cup"];
    case "check":
    case "escort":
      return [];
    case "reposition":
      return ["hoist"];
    default:
      return [c.resident!.resident!.data.care.transfer_method === "hoist" ? "hoist" : "towel"];
  }
}

/** Sips and mouth care for someone who can no longer eat or drink much (Dennis): end-of-life comfort care. */
export function sipsAndMouthCare(world: World, r: Person): void {
  const res = r.resident!;
  if (res.data.care.eating_support !== "mouth_care_only") return;
  res.fluidsMlToday += 50;
  res.lastMouthCareT = world.t;
  lower(r, "thirst", 0.3);
  if (CHARTED.has(r.id)) emit(world, "intake.recorded", [r.id], { residentId: r.id, fluidsMl: 50 });
}

function careEffects(c: Ctx): void {
  const { world } = c;
  const r = c.resident!;
  const res = r.resident!;
  const staffIds = [...c.task.assigned];
  c.task.data.phase = null;
  c.task.data.effectsDone = 1;
  switch (careKind(c)) {
    case "morning":
      // Tea on waking is its own visit now (care "tea"), not part of washing and dressing.
      toileted(world, r);
      res.morningDone = true;
      emit(world, "care.personal_care_done", [r.id, ...staffIds], { residentId: r.id, staffIds, period: "morning" });
      break;
    case "bedtime":
      toileted(world, r);
      res.bedtimeDone = true;
      // A warm drink at bedtime.
      lower(r, "thirst", 0.5);
      res.fluidsMlToday += 150;
      drank(r);
      emit(world, "care.personal_care_done", [r.id, ...staffIds], { residentId: r.id, staffIds, period: "evening" });
      break;
    case "tea": {
      // Tea on waking; early risers waiting for care get toast with it.
      lower(r, "thirst", 0.5);
      res.fluidsMlToday += 150;
      res.teaDone = true;
      if (c.task.data.toast === 1) {
        lower(r, "hunger", 0.4);
        res.toastDone = true;
      }
      drank(r);
      emit(world, "drink.served", [r.id, staffIds[0]!], { residentId: r.id, round: "waking", staffId: staffIds[0]!, outcome: "drunk" });
      break;
    }
    case "comfort":
      sipsAndMouthCare(world, r);
      break;
    case "escort":
      lower(r, "social", 0.1); // a chat on the way
      break;
    case "check":
      sipsAndMouthCare(world, r);
      return;
    case "reposition":
      toileted(world, r); // turns include a pad change
      sipsAndMouthCare(world, r);
      emit(world, "resident.repositioned", [r.id, ...staffIds], { residentId: r.id, staffIds });
      break;
    case "pad_change":
      toileted(world, r);
      break;
    case "meal": {
      const meal = c.task.data.meal as MealName;
      lower(r, "hunger", 0.8);
      lower(r, "thirst", 0.6); // a drink with every meal
      const fluids = res.data.care.eating_support === "mouth_care_only" ? 50 : 200;
      res.fluidsMlToday += fluids;
      drank(r);
      res.mealsServed.push(meal);
      emit(world, "meal.served", [r.id, staffIds[0]!], { residentId: r.id, meal, staffId: staffIds[0]! });
      if (CHARTED.has(r.id)) {
        const mealPct = res.data.care.eating_support === "mouth_care_only" ? 0 : 40 + world.rng.needs.int(0, 12) * 5;
        emit(world, "intake.recorded", [r.id], { residentId: r.id, mealPct, fluidsMl: fluids });
      }
      break;
    }
  }
}

/** After morning care residents get up to their chair; at bedtime they go to bed. */
const settleResident: BtNode<Ctx> = leaf("settle the resident", (c, mem) => {
  const r = c.resident!;
  const res = r.resident!;
  const care = careKind(c);
  const hoist = res.data.care.transfer_method === "hoist";
  if (care === "morning" && !res.data.care.bed_bound) {
    if (mem.started === undefined) {
      mem.started = 1;
      if (hoist) {
        placeAt(c.world, r, chairFor(r));
        res.inBed = false;
        emit(c.world, "resident.transferred", [r.id, ...c.task.assigned], { residentId: r.id, staffIds: [...c.task.assigned], method: "hoist", from: "bed", to: "chair" });
      } else {
        getOutOfBed(c.world, r);
        walkTo(c.world, r, chairFor(r));
      }
    }
    if (r.move) return "running";
    r.posture = "sitting";
    emit(c.world, "resident.got_up", [r.id], { residentId: r.id, to: chairFor(r) });
    return "success";
  }
  if (care === "bedtime" && !res.inBed) {
    if (hoist) {
      getIntoBed(c.world, r);
      emit(c.world, "resident.transferred", [r.id, ...c.task.assigned], { residentId: r.id, staffIds: [...c.task.assigned], method: "hoist", from: "chair", to: "bed" });
    } else {
      if (mem.started === undefined) {
        mem.started = 1;
        walkTo(c.world, r, `${res.data.room}.Side`);
      }
      if (r.move) return "running";
      getIntoBed(c.world, r);
    }
    emit(c.world, "resident.went_to_bed", [r.id], { residentId: r.id });
    res.lastTurnedT = c.world.t; // settled in bed: the night repositioning clock starts
  }
  return "success";
});

/** A waiting help request is met by the scheduled care now under way, if it can be (tasks.ts `absorbInto`). */
function absorbRequest(c: Ctx): void {
  const requestId = c.resident!.resident!.requestId;
  const request = requestId ? c.world.tasks.get(requestId) : undefined;
  if (request) absorbInto(c.world, c.task, request);
}

function meetAbsorbedRequest(c: Ctx): void {
  const request = c.task.data.absorbed ? c.world.tasks.get(String(c.task.data.absorbed)) : undefined;
  if (!request) return;
  const r = c.resident!;
  if (request.need === "toileting") toileted(c.world, r);
  else lower(r, request.need!, 0.6);
  if (request.need === "thirst") r.resident!.fluidsMlToday += 200;
  request.assigned = [...c.task.assigned];
  finish(c.world, request, "success");
}

/** Walking a resident to or from the Lounge (Peggy with her frame, Stan): the carer walks beside them. */
const escortTree: BtNode<Ctx> = seq(
  "escort",
  leaf("is an escort?", (c) => (careKind(c) === "escort" ? "success" : "failure")),
  goTo("go to resident", (c) => c.staff, (c) => besideThem(c.resident!)),
  act("set off", (c) => {
    begin(c, careBadge(c));
    markChecked(c.world, c.resident!, c.staff, false);
    absorbRequest(c);
    const r = c.resident!;
    if (r.resident!.inBed) getOutOfBed(c.world, r);
    walkTo(c.world, r, String(c.task.data.to));
  }),
  walkWith("walk with them", (c) => [String(c.task.data.to)]),
  act("settle", (c) => {
    c.resident!.posture = "sitting";
    careEffects(c);
    meetAbsorbedRequest(c);
  }),
);

const careAtResident: BtNode<Ctx> = seq(
  "care",
  goTo("go to resident", (c) => c.staff, (c) => besideThem(c.resident!)),
  act("begin", (c) => {
    begin(c, careBadge(c));
    // The check counts the moment a carer is at the bedside; mouth care and so on follow.
    markChecked(c.world, c.resident!, c.staff, careKind(c) === "check");
    // A turn counts from when it starts; personal care in bed turns a bed-bound resident too.
    const res = c.resident!.resident!;
    if (careKind(c) === "reposition" || (res.data.care.bed_bound && (careKind(c) === "morning" || careKind(c) === "bedtime"))) res.lastTurnedT = c.world.t;
    absorbRequest(c);
  }),
  waitMins("care", (c) => careMinutes(c) + ppeMins(c.world, c.resident)),
  act("finish", (c) => {
    careEffects(c);
    meetAbsorbedRequest(c);
  }),
  settleResident,
);

const careTree: BtNode<Ctx> = sel("care", escortTree, careAtResident);

// ---------------------------------------------------------------- drinks round

const ROUND_MINUTES_EACH = 2;

const roundTree: BtNode<Ctx> = seq(
  "round",
  act("begin", (c) => begin(c, ["cup"])),
  leaf("take drinks round", (c, mem) => {
    const ids = c.task.data.residents as string[];
    const staff = c.staff[0]!;
    for (;;) {
      const i = mem.i ?? 0;
      if (i >= ids.length) return "success";
      const r = c.world.people.get(ids[i]!)!;
      const res = r.resident!;
      if (!r.onMap) {
        mem.i = i + 1;
        mem.phase = 0;
        continue;
      }
      if (!mem.phase) {
        const spot = besideThem(r)[0]!;
        if (staff.atPoint !== spot) {
          if (staff.move?.destPointId !== spot) walkTo(c.world, staff, spot);
          return "running";
        }
        mem.phase = 1;
        mem.start = c.world.t;
        markChecked(c.world, r, [staff], false, false);
      }
      if (c.world.t - mem.start! < (ROUND_MINUTES_EACH + ppeMins(c.world, r)) * 60) return "running";
      const round = c.task.data.round as DrinkRound;
      const mouthCare = res.data.care.eating_support === "mouth_care_only";
      let outcome: DrinkOutcome = "drunk";
      if (mouthCare) sipsAndMouthCare(c.world, r); // Dennis gets sips, asleep or not
      else if (res.asleep || res.busyTaskId) {
        // Asleep or busy: someone who needs help to drink is owed it at the next contact; anyone
        // else has it left by them (stale after 2 hours, replaced at the next contact).
        if (needsHelpToDrink(res.data)) {
          res.drinkOwed = true;
          outcome = "owed";
        } else {
          Object.assign(res, { drinkLeftT: c.world.t, drinkStale: false });
          outcome = "left";
        }
      } else {
        lower(r, "thirst", 0.7);
        // A biscuit; the 20:00 round brings a supper snack (toast or a sandwich) to last the night.
        lower(r, "hunger", round === "late_drink" ? 0.4 : 0.2);
        res.fluidsMlToday += 200;
        drank(r);
      }
      emit(c.world, "drink.served", [r.id, staff.id], { residentId: r.id, round, staffId: staff.id, outcome });
      mem.i = i + 1;
      mem.phase = 0;
    }
  }),
);

// ---------------------------------------------------------------- self-toilet

const selfToiletTree: BtNode<Ctx> = seq(
  "self_toilet",
  act("get up", (c) => {
    if (c.resident!.resident!.inBed) getOutOfBed(c.world, c.resident!);
  }),
  goTo("walk to the WC", (c) => [c.resident!], (c) => [String(c.task.data.wc)]),
  waitMins("on the toilet", () => 3),
  act("done", (c) => toileted(c.world, c.resident!)),
  goTo("walk back", (c) => [c.resident!], (c) => [String(c.task.data.returnTo)]),
  act("settle", (c) => {
    if (c.task.data.returnToBed === 1) getIntoBed(c.world, c.resident!);
    else c.resident!.posture = "sitting";
  }),
);

// ---------------------------------------------------------------- self-move, Lounge check

/** A resident who walks alone goes to or from the Lounge. */
const selfMoveTree: BtNode<Ctx> = seq(
  "self_move",
  act("get up", (c) => {
    if (c.resident!.resident!.inBed) getOutOfBed(c.world, c.resident!);
  }),
  goTo("walk there", (c) => [c.resident!], (c) => [String(c.task.data.to)]),
  act("sit down", (c) => {
    c.resident!.posture = "sitting";
  }),
);

/** A carer looks in on the Lounge while residents who need supervision are there (docs/05). */
const loungeCheckTree: BtNode<Ctx> = seq(
  "lounge_check",
  goTo("go to the Lounge", (c) => c.staff, () => ["Lounge.Post"]),
  act("begin", (c) => begin(c, [])),
  waitMins("look in", () => 2),
);

// ---------------------------------------------------------------- handover, briefing, break

function handoverMembersPresent(c: Ctx): boolean {
  const members = c.task.members!;
  const present = (id: string) => {
    const p = c.world.people.get(id);
    return !!p && c.task.assigned.includes(id) && p.roomId === "StaffRoom" && !p.move;
  };
  if (members.every(present)) return true;
  // Don't wait for ever for someone who hasn't turned up: go ahead after 20 minutes if both sides
  // are there, and after 30 with whoever is (the written notes stand in for anyone missing).
  const from = c.task.data.from as string[];
  const to = c.task.data.to as string[];
  const waited = c.world.t - c.task.createdT;
  if (waited >= 20 * 60 && from.some(present) && to.some(present)) return true;
  return waited >= 30 * 60 && members.some(present);
}

function handoverSummary(world: World) {
  // Everyone living here now, including anyone who has moved in (docs/10).
  return world.data.residents.filter((r) => world.people.get(r.id)?.resident?.away !== "died").map((r) => {
    const log = world.shiftLog.get(r.id)!;
    const res = world.people.get(r.id)!.resident!;
    const hoursSince7 = Math.max(0, Math.min(14, ((world.t % 86400) / 3600 - 7 + 24) % 24));
    const expected = (r.nutrition.fluids_target_ml * hoursSince7) / 14;
    return {
      residentId: r.id,
      falls: log.falls,
      lateOrMissedDoses: log.lateOrMissedDoses,
      helpRequests: log.helpRequests,
      fluidsBelowTarget: res.fluidsMlToday < 0.8 * expected,
      checksDone: log.checksDone,
    };
  });
}

/** The floor is covered by someone other than the handover's members. */
function coveredByOthers(c: Ctx): boolean {
  return c.world.order.some((id) => !c.task.members!.includes(id) && onFloor(c.world, c.world.people.get(id)!));
}

/** The handover's floor cover; if they've gone (taken ill), an incoming member who is here covers instead and reads the notes. */
function replaceGoneCover(c: Ctx): Person | undefined {
  const cover = c.task.data.cover ? c.world.people.get(String(c.task.data.cover)) : undefined;
  if (!cover || (cover.onMap && onDuty(cover))) return cover;
  const here = (c.task.data.to as string[]).map((id) => c.world.people.get(id)!).filter((p) => p.onMap && onDuty(p)).at(-1);
  if (!here) return cover;
  c.task.members = c.task.members!.filter((id) => id !== here.id);
  c.task.data.to = (c.task.data.to as string[]).filter((id) => id !== here.id);
  if (c.task.assigned.includes(here.id)) {
    c.task.assigned = c.task.assigned.filter((id) => id !== here.id);
    here.staff!.taskId = null;
    Object.assign(here, { badges: [], task: null });
  }
  c.task.data.cover = here.id;
  return here;
}

const handoverTree: BtNode<Ctx> = seq(
  "handover",
  until("floor covered", (c) => {
    const cover = replaceGoneCover(c);
    return !cover || !onDuty(cover) || onFloor(c.world, cover) || coveredByOthers(c);
  }),
  leaf("gather in the staff room", (c) => {
    replaceGoneCover(c); // the cover may be taken ill while the others gather
    c.staff.forEach((p, i) => {
      const seat = STAFF_ROOM_SEATS[i % STAFF_ROOM_SEATS.length]!;
      if (p.atPoint !== seat && p.move?.destPointId !== seat) walkTo(c.world, p, seat);
    });
    return handoverMembersPresent(c) ? "success" : "running";
  }),
  act("start", (c) => {
    c.task.startedT = c.world.t;
    const { from, to, cover } = c.task.data as { from: string[]; to: string[]; cover: string | null };
    setBadges(c.staff, ["handover"], "Handover");
    emit(c.world, "handover.started", c.task.assigned, { from, to, floorCover: cover ?? "" });
  }),
  waitMins("hand over", (c) => Number(c.task.data.durationMins)),
  act("complete", (c) => {
    const { from, to, cover } = c.task.data as { from: string[]; to: string[]; cover: string | null };
    emit(c.world, "handover.completed", c.task.assigned, { from, to, floorCover: cover ?? "", summary: handoverSummary(c.world) });
    for (const log of c.world.shiftLog.values()) Object.assign(log, { falls: 0, lateOrMissedDoses: 0, helpRequests: 0, checksDone: 0 });
    if (c.task.data.briefCover === 1 && cover) createBriefing(c.world, to[0]!, cover);
  }),
);

const briefingTree: BtNode<Ctx> = seq(
  "briefing",
  until("both free", (c) => c.task.assigned.length === 2),
  goTo("meet on the floor", (c) => c.staff, () => ["Corridor.Mid"]),
  act("start", (c) => {
    c.task.startedT = c.world.t;
    setBadges(c.staff, ["handover"], "Briefing");
  }),
  waitMins("brief", () => 5),
);

const breakTree: BtNode<Ctx> = seq(
  "break",
  goTo("go to break spot", (c) => c.staff, (c) => [String(c.task.data.point)]),
  act("start", (c) => {
    setBadges(c.staff, ["break"], "Break");
    if (c.task.data.startLogged !== 1) {
      c.task.data.startLogged = 1;
      emit(c.world, "break.started", [c.staff[0]!.id], { staffId: c.staff[0]!.id, pointId: String(c.task.data.point) });
    }
  }),
  leaf("rest", (c) => {
    if (c.world.t % 60 === 0) c.task.data.remainingMins = Number(c.task.data.remainingMins) - 1;
    return Number(c.task.data.remainingMins) <= 0 ? "success" : "running";
  }),
  act("end", (c) => {
    c.staff[0]!.staff!.breakTaken = true;
    emit(c.world, "break.ended", [c.staff[0]!.id], { staffId: c.staff[0]!.id });
  }),
);

export { assistTree, selfToiletTree, selfMoveTree, careTree, roundTree, handoverTree, briefingTree, breakTree, loungeCheckTree };

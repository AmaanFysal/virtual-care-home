// Behaviour audit (`sim --audit`): runs the sim and watches the event log and the world state
// (every tick for staff time and movement, every minute for needs and places), then reports
// per resident, per staff shift and per day, with flags where behaviour looks wrong.
// Read-only: it never changes the world. Thresholds live in audit.config.ts.

import { clockToSeconds, formatSimTime, timeOfDay, type AnySimEvent, type NeedName, type WorldData } from "@vch/shared-types";
import { createSim, type Person, type World } from "../src/index.js";
import { ACT_THRESHOLD } from "../src/needs.js";
import { isNight } from "../src/nightcover.js";
import { isCareStaff, type ShiftAssignment } from "../src/state.js";
import { cellAt } from "../src/world/grid.js";
import { AUDIT, type AuditConfig } from "./audit.config.js";

export interface Flag {
  type: string;
  /** Resident, staff member or "wing". */
  subject: string;
  t: number;
  detail: string;
}

export interface AuditResult {
  lines: string[];
  flags: Flag[];
}

const NEEDS: NeedName[] = ["hunger", "thirst", "toileting", "social", "fatigue"];
const MEALS = ["breakfast", "lunch", "supper"] as const;
type Meal = (typeof MEALS)[number];
type Round = keyof AuditConfig["drinks"]["rounds"];

const hm = (t: number) => formatSimTime(t).slice(11);
const m = (secs: number) => Math.round(secs / 60);
const hmins = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h${String(Math.round(mins % 60)).padStart(2, "0")}` : `${Math.round(mins)}m`);
const first = (p: Person) => p.name.split(" ")[0]!;

interface ResDay {
  minutes: number;
  highMins: Record<NeedName, number>;
  peak: Record<NeedName, { v: number; t: number; cause: string }>;
  wakeT: number | null;
  firstDrinkT: number | null;
  firstFoodT: number | null;
  morningCreatedT: number | null;
  teaT: number | null;
  dozes: number;
  mouthCareGap: [number, number] | null;
  morningStartT: number | null;
  meals: Partial<Record<Meal, number>>;
  drinks: Partial<Record<Round, { t: number; status: string }>>;
  where: Record<string, number>;
  furthestM: number;
  leftBedArea: boolean;
  roomsVisited: Set<string>;
  checkGap: { day: [number, number]; night: [number, number] }; // [longest mins, plan mins]
  turnGap: [number, number] | null;
  requests: number;
  longestWait: number;
}

interface ShiftRec {
  a: ShiftAssignment;
  personId: string;
  name: string;
  ticks: Record<string, number>;
  walkingFor: Record<string, number>;
  overtimeTicks: number;
  breakStartT: number | null;
  breakEndT: number | null;
  breakTicks: number;
  breakInterrupted: boolean;
  idleStreak: { from: number; worst: string; worstV: number } | null;
}

interface RoundRec {
  taskId: string;
  round: string;
  dueT: number;
  startT: number | null;
  endT: number | null;
  giver: string | null;
  expected: string[];
  given: Set<string>;
  interruptions: { t: number; reason: string }[];
  late: { id: string; mins: number }[];
  missed: string[];
}

export function runAudit(seed: string, hours: number, data: WorldData, cfg: AuditConfig = AUDIT): AuditResult {
  const sim = createSim({ seed, data });
  const w = sim.world;
  const flags: Flag[] = [];
  const flag = (type: string, subject: string, t: number, detail: string) => flags.push({ type, subject, t, detail });

  const dayOff = clockToSeconds(cfg.careDayStartsAt);
  const dayKey = (t: number) => Math.floor((t - dayOff) / 86400);
  const dayLabel = (k: number) => formatSimTime(k * 86400 + dayOff).slice(0, 10);
  const tod = (clock: string) => clockToSeconds(clock);
  const residents = w.order.map((id) => w.people.get(id)!).filter((p) => p.resident);
  const names = new Map<string, string>();
  const name = (id: string) => w.people.get(id)?.name ?? names.get(id) ?? id;

  // ------------------------------------------------------------ state kept while running
  const resDays = new Map<string, Map<number, ResDay>>(residents.map((r) => [r.id, new Map()]));
  const resDay = (id: string, t: number): ResDay => {
    const days = resDays.get(id)!;
    const k = dayKey(t);
    let d = days.get(k);
    if (!d) {
      d = {
        minutes: 0,
        highMins: { hunger: 0, thirst: 0, toileting: 0, social: 0, fatigue: 0 },
        peak: Object.fromEntries(NEEDS.map((n) => [n, { v: -1, t: 0, cause: "" }])) as ResDay["peak"],
        wakeT: null,
        firstDrinkT: null,
        firstFoodT: null,
        morningCreatedT: null,
        teaT: null,
        dozes: 0,
        mouthCareGap: null,
        morningStartT: null,
        meals: {},
        drinks: {},
        where: {},
        furthestM: 0,
        leftBedArea: false,
        roomsVisited: new Set(),
        checkGap: { day: [0, 0], night: [0, 0] },
        turnGap: null,
        requests: 0,
        longestWait: 0,
      };
      days.set(k, d);
    }
    return d;
  };

  /** First drink after waking, from what staff logged (drinks, meals, sips) or a drop in thirst. */
  function drankAt(id: string, t: number): void {
    const d = resDay(id, t);
    if (d.wakeT !== null && d.firstDrinkT === null && t >= d.wakeT) d.firstDrinkT = t;
  }
  /** Room per person rebuilt from the event log (arrived, entered_room, departed), for the occupancy check. */
  const occupancy = new Map<string, string | null>([...w.people.values()].map((p) => [p.id, p.onMap ? p.roomId : null]));
  const occupancyBad = new Set<string>();
  const mouthEp = new Map<string, { last: number; max: number }>();

  interface TaskInfo {
    kind: string;
    residentId: string | null;
    label: string;
    createdT: number;
    startedT: number | null;
    deadlineT: number | null;
    request: boolean;
    need: NeedName | null;
    round: string | null;
    done: boolean;
    lastReason: string | null;
  }
  const tasks = new Map<string, TaskInfo>();
  const openRequests = new Set<string>();
  const prevNeeds = new Map<string, Record<NeedName, number>>();
  const tickThirst = new Map<string, number>();
  const tickHunger = new Map<string, number>();
  const lastRelief = new Map<string, Record<NeedName, number>>(residents.map((r) => [r.id, { hunger: w.t, thirst: w.t, toileting: w.t, social: w.t, fatigue: w.t }]));
  const highEpisodes = new Map<string, { from: number; peak: number; peakT: number; startCause: string; peakCause: string }>();
  const inBedEpisode = new Map<string, { from: number; why: string }>();
  const checkEp = new Map<string, { last: number; interval: number; night: boolean; max: number }>();
  const turnEp = new Map<string, { last: number; interval: number; max: number }>();
  const leftDrinks = new Map<string, { t: number; round: string; flagged?: boolean }>();
  const visits = new Map<string, number>(residents.map((r) => [r.id, 0]));
  const shifts = new Map<ShiftAssignment, ShiftRec>();
  const rounds = new Map<string, RoundRec>();
  const drinkRounds = new Map<string, { round: string; createdT: number; startT: number | null }>();
  const morningOrder = new Map<number, { id: string; wakeT: number | null; dueT: number; startT: number | null }[]>();
  const stationary = new Map<string, { from: number; x: number; y: number; where: string; doing: string }>();
  const lastPos = new Map<string, { x: number; y: number }>();
  const samePlace = new Map<string, { from: number; where: string }>();
  const cellHist = new Map<string, { cells: number[]; reversals: number[]; flaggedUntil: number }>();

  // ------------------------------------------------------------ helpers
  const openTasksFor = (id: string) => [...w.tasks.values()].filter((t) => t.residentId === id && t.kind !== "idle" && t.status !== "done");

  function situation(p: Person, need?: NeedName): string {
    const res = p.resident!;
    if (!p.onMap) return "away from the wing";
    if (res.fall) return "on the floor after a fall";
    const parts = [res.asleep ? "asleep" : "awake", res.inBed ? "in bed" : p.posture === "sitting" ? "in chair" : p.posture];
    const busy = res.busyTaskId ? w.tasks.get(res.busyTaskId) : undefined;
    if (busy) parts.push(`busy: ${busy.label}`);
    for (const t of openTasksFor(p.id)) {
      if (t.id === res.busyTaskId) continue;
      const state = t.status === "open" ? (t.assigned.length ? "held for a partner" : "waiting") : t.status;
      parts.push(`${t.label} ${state} ${m(w.t - t.createdT)}m`);
    }
    if (!busy && openTasksFor(p.id).length === 0) {
      parts.push("nothing open");
      if (need && !res.asleep && res.needs[need] < ACT_THRESHOLD[need]) parts.push(`below ask threshold ${ACT_THRESHOLD[need]}`);
      if (need && !res.data.care.can_request_help) parts.push("can't ask for help");
    }
    return parts.join(", ");
  }

  function staffCategory(p: Person): { cat: string; purpose: string } {
    const task = p.staff!.taskId ? w.tasks.get(p.staff!.taskId) : undefined;
    // Holding a two-person task alone (no longer done) or waiting, free, on a reservation.
    const held = (task && task.status === "open" && task.assigned.length > 0 && task.assigned.length < task.staffNeeded) || (!task && !p.move && [...w.tasks.values()].some((t) => t.status === "open" && t.data.reservedBy === p.id));
    const purpose = !task ? (p.staff!.duty === "leaving" ? "leaving" : "to post") : task.kind === "care" ? `care.${task.data.care}` : task.kind === "idle" ? `idle.${task.data.activity}` : task.kind;
    if (held) return { cat: "waiting for partner", purpose };
    if (p.move) return { cat: "walking", purpose };
    if (!task) return { cat: "free (at post)", purpose };
    switch (task.kind) {
      case "assist":
      case "care":
      case "fall":
      case "let_in":
        return { cat: "care", purpose };
      case "round":
      case "med_round":
        return { cat: "rounds", purpose };
      case "idle":
        return { cat: "idle activity", purpose };
      case "break":
        return { cat: "break", purpose };
      default:
        return { cat: "handover", purpose };
    }
  }

  function whereIs(p: Person): string {
    const res = p.resident!;
    if (!p.onMap) return "away";
    if (res.inBed) return "bed";
    if (p.atPoint === `${res.data.room}.Chair`) return "chair";
    if (p.atPoint?.endsWith(".WC")) return "wc";
    if (p.roomId === res.data.room.split(".")[0]) return "bedroom";
    if (p.roomId === "Lounge") return p.posture === "dozing" ? "lounge (dozing)" : "lounge";
    if (p.roomId === "WaitingArea") return "waiting area";
    return p.roomId ?? "other";
  }

  const onWcTrip = (p: Person) => {
    const t = p.resident!.busyTaskId ? w.tasks.get(p.resident!.busyTaskId) : undefined;
    return !!t && (t.kind === "self_toilet" || t.data.method === "escort");
  };

  const shiftRec = (p: Person): ShiftRec | null => {
    const a = p.staff?.shift;
    if (!a || !a.started || p.kind === "external") return null;
    let rec = shifts.get(a);
    if (!rec) {
      rec = { a, personId: p.id, name: p.name, ticks: {}, walkingFor: {}, overtimeTicks: 0, breakStartT: null, breakEndT: null, breakTicks: 0, breakInterrupted: false, idleStreak: null };
      shifts.set(a, rec);
    }
    return rec;
  };

  const roundFor = (roundName: string) => [...rounds.values()].reverse().find((r) => r.round === roundName && r.endT === null) ?? [...rounds.values()].reverse().find((r) => r.round === roundName);

  // ------------------------------------------------------------ events
  function onEvent(e: AnySimEvent): void {
    switch (e.type) {
      case "task.created": {
        const t = w.tasks.get(e.payload.taskId);
        tasks.set(e.payload.taskId, {
          kind: e.payload.kind,
          residentId: e.payload.residentId,
          label: t?.label ?? e.payload.kind,
          createdT: e.t,
          startedT: null,
          deadlineT: t?.deadlineT ?? null,
          request: t?.request ?? false,
          need: t?.need ?? null,
          round: t ? (t.data.round as string | undefined) ?? null : null,
          done: false,
          lastReason: null,
        });
        if (e.payload.kind === "care.morning" && e.payload.residentId) {
          const d = resDay(e.payload.residentId, e.t);
          d.morningCreatedT = e.t;
          const list = morningOrder.get(dayKey(e.t)) ?? [];
          list.push({ id: e.payload.residentId, wakeT: d.wakeT, dueT: e.t, startT: null });
          morningOrder.set(dayKey(e.t), list);
        }
        if (e.payload.kind === "med_round" && t) {
          const expected = residents.filter((r) => r.onMap).map((r) => r.id);
          rounds.set(t.id, { taskId: t.id, round: String(t.data.round), dueT: e.t, startT: null, endT: null, giver: t.members?.[0] ?? null, expected, given: new Set(), interruptions: [], late: [], missed: [] });
        }
        if (e.payload.kind === "round" && t) drinkRounds.set(t.id, { round: String(t.data.round), createdT: e.t, startT: null });
        break;
      }
      case "task.started": {
        const info = tasks.get(e.payload.taskId);
        if (info) info.startedT = e.t;
        if (info?.kind === "care.morning" && info.residentId) {
          resDay(info.residentId, info.createdT).morningStartT = e.t;
          const row = morningOrder.get(dayKey(info.createdT))?.find((r) => r.id === info.residentId && r.startT === null);
          if (row) row.startT = e.t;
        }
        const dr = drinkRounds.get(e.payload.taskId);
        if (dr) dr.startT = e.t;
        break;
      }
      case "task.interrupted": {
        const info = tasks.get(e.payload.taskId);
        if (info) info.lastReason = e.payload.reason;
        const r = rounds.get(e.payload.taskId);
        if (r) r.interruptions.push({ t: e.t, reason: e.payload.reason });
        break;
      }
      case "task.completed": {
        const info = tasks.get(e.payload.taskId);
        if (info) info.done = true;
        break;
      }
      case "resident.requested_help": {
        openRequests.add(e.payload.taskId);
        resDay(e.payload.residentId, e.t).requests += 1;
        break;
      }
      case "resident.woke": {
        const s = timeOfDay(e.t);
        if (s >= tod(cfg.morning.wakeWindow[0]) && s < tod(cfg.morning.wakeWindow[1])) {
          const d = resDay(e.payload.residentId, e.t);
          d.wakeT = e.t;
          d.firstDrinkT = null; // count from the last wake-up of the night
          d.firstFoodT = null;
        }
        break;
      }
      case "meal.served":
        resDay(e.payload.residentId, e.t).meals[e.payload.meal] = e.t;
        drankAt(e.payload.residentId, e.t);
        break;
      case "intake.recorded":
        if (e.payload.fluidsMl) drankAt(e.payload.residentId, e.t);
        break;
      case "drink.served": {
        const r = w.people.get(e.payload.residentId)!;
        const d = resDay(r.id, e.t);
        const round = e.payload.round;
        if (e.payload.outcome === "drunk") drankAt(r.id, e.t);
        if (round === "waking") d.teaT = e.t;
        if (round === "top_up") {
          // Replaces a stale or owed drink.
          const pending = leftDrinks.get(r.id);
          if (pending) {
            const dd = resDay(r.id, pending.t).drinks[pending.round as Round];
            if (dd) dd.status = `${dd.status.startsWith("owed") ? "owed" : "left, went stale"}, ${e.payload.outcome === "left" ? "fresh one left" : "given"} ${hm(e.t)}`;
            if (e.payload.outcome === "left") leftDrinks.set(r.id, { t: e.t, round: pending.round });
            else leftDrinks.delete(r.id);
          }
          break;
        }
        if (!(round in cfg.drinks.rounds)) break;
        d.drinks[round as Round] = { t: e.t, status: e.payload.outcome === "drunk" ? "drunk" : e.payload.outcome === "left" ? "left by bed" : "owed (needs help)" };
        if (e.payload.outcome !== "drunk" && !leftDrinks.has(r.id)) leftDrinks.set(r.id, { t: e.t, round });
        break;
      }
      case "sla.breached":
        flag(`service.${e.payload.target}`, e.payload.residentId, e.t, `${e.payload.details} [${e.payload.cause}]`);
        break;
      case "person.entered_room":
        occupancy.set(e.actors[0]!, e.payload.roomId);
        break;
      case "person.arrived":
        occupancy.set(e.actors[0]!, null);
        break;
      case "person.departed":
        occupancy.set(e.actors[0]!, null);
        break;
      case "resident.fell_asleep":
        if (e.payload.where === "lounge") resDay(e.payload.residentId, e.t).dozes += 1;
        break;
      case "med_round.started": {
        const r = roundFor(e.payload.round);
        if (r && r.startT === null) (r.startT = e.t), (r.giver = e.payload.staffId);
        break;
      }
      case "med_round.completed": {
        const r = roundFor(e.payload.round);
        if (r) r.endT = e.t;
        break;
      }
      case "med.administered": {
        roundFor(e.payload.round)?.given.add(e.payload.residentId);
        break;
      }
      case "med.late": {
        roundFor(e.payload.round)?.late.push({ id: e.payload.residentId, mins: e.payload.lateMins });
        break;
      }
      case "med.missed": {
        const r = roundFor(e.payload.round);
        if (r) r.missed.push(e.payload.residentId), r.given.add(e.payload.residentId);
        break;
      }
      case "visit.started":
        visits.set(e.payload.residentId, (visits.get(e.payload.residentId) ?? 0) + 1);
        break;
      case "break.started": {
        const p = w.people.get(e.payload.staffId)!;
        const rec = shiftRec(p);
        if (rec && rec.breakStartT === null) rec.breakStartT = e.t;
        break;
      }
      case "break.ended": {
        const p = w.people.get(e.payload.staffId)!;
        const rec = shiftRec(p);
        if (rec) rec.breakEndT = e.t;
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------ every tick
  function onTick(): void {
    const t = w.t;
    if (w.t % 3600 === 0) for (const p of w.people.values()) names.set(p.id, p.name);
    // Requests that closed: with real relief, or not at all.
    for (const id of [...openRequests]) {
      const info = tasks.get(id)!;
      const live = w.tasks.get(id);
      if (live && live.status !== "done") continue;
      openRequests.delete(id);
      const r = w.people.get(info.residentId!)!;
      const d = resDay(r.id, info.createdT);
      const waited = m((info.startedT ?? t) - info.createdT);
      d.longestWait = Math.max(d.longestWait, waited);
      if (!info.done) {
        flag("request.closed_without_help", r.id, t, `${info.label} (asked ${hm(info.createdT)}) removed without help: ${info.lastReason ?? "no reason logged"}`);
        continue;
      }
      if (info.deadlineT !== null && info.startedT !== null && info.startedT > info.deadlineT)
        flag("request.over_wait_limit", r.id, info.createdT, `${info.label} asked ${hm(info.createdT)}, help began ${hm(info.startedT)} (${waited}m; limit ${m(info.deadlineT - info.createdT)}m)`);
      const after = r.resident!.needs[info.need!];
      if (after >= cfg.requests.relievedBelow) flag("request.closed_without_relief", r.id, t, `${info.label} closed at ${hm(t)} with ${info.need} still ${after.toFixed(2)}`);
    }

    // Room occupancy from events must match the world, for everyone (the air module relies on it).
    for (const p of w.people.values()) {
      const logged = occupancy.get(p.id) ?? null;
      const actual = p.onMap ? p.roomId : null;
      if (logged !== actual && !occupancyBad.has(p.id)) {
        occupancyBad.add(p.id);
        flag("rooms.occupancy_mismatch", p.id, t, `${p.name}: events say ${logged ?? "off the map"}, world says ${actual ?? "off the map"}`);
      } else if (logged === actual) occupancyBad.delete(p.id);
    }

    // First food after waking, to the tick (a big drop in hunger: a meal, toast, a snack).
    for (const r of residents) {
      const hunger = r.resident!.needs.hunger;
      const before = tickHunger.get(r.id);
      tickHunger.set(r.id, hunger);
      if (before === undefined || hunger >= before - cfg.morning.foodDrop) continue;
      const d = resDay(r.id, t);
      if (d.wakeT !== null && d.firstFoodT === null && t >= d.wakeT) d.firstFoodT = t;
    }
    // First drink after waking, to the tick (a big drop in thirst).
    for (const r of residents) {
      const thirst = r.resident!.needs.thirst;
      const before = tickThirst.get(r.id);
      tickThirst.set(r.id, thirst);
      if (before === undefined || thirst >= before - cfg.morning.drinkDrop) continue;
      const d = resDay(r.id, t);
      if (d.wakeT !== null && d.firstDrinkT === null && t >= d.wakeT) d.firstDrinkT = t;
    }

    for (const id of w.order) {
      const p = w.people.get(id)!;
      // Staff time split.
      if (p.staff && p.onMap) {
        const rec = shiftRec(p);
        if (rec && (p.staff.duty === "on_shift" || p.staff.duty === "staying" || p.staff.duty === "leaving")) {
          const { cat, purpose } = staffCategory(p);
          rec.ticks[cat] = (rec.ticks[cat] ?? 0) + 1;
          if (cat === "walking") rec.walkingFor[purpose] = (rec.walkingFor[purpose] ?? 0) + 1;
          if (cat === "break") rec.breakTicks += 1;
          if (t > rec.a.endT) rec.overtimeTicks += 1;
        }
      }

      // Movement.
      if (!p.onMap) {
        stationary.delete(id);
        lastPos.delete(id);
        cellHist.delete(id);
        continue;
      }
      const prev = lastPos.get(id);
      const still = !!prev && Math.abs(prev.x - p.x) < 1e-6 && Math.abs(prev.y - p.y) < 1e-6;
      lastPos.set(id, { x: p.x, y: p.y });
      const cell = cellAt(w.grid, p.x, p.y);
      const door = w.grid.doorZoneOf[cell];
      const exposed = p.roomId === "Corridor" || !!door;
      const st = stationary.get(id);
      if (still && exposed) {
        if (!st) stationary.set(id, { from: t, x: p.x, y: p.y, where: door ? `doorway ${door}` : `corridor (${p.atPoint ?? `${p.x.toFixed(1)},${p.y.toFixed(1)}`})`, doing: doingNow(p) });
      } else if (st) {
        endStationary(id, st, t);
        stationary.delete(id);
      }
      // Oscillation: cell reversals (A to B and straight back to A).
      const h = cellHist.get(id) ?? { cells: [], reversals: [], flaggedUntil: 0 };
      cellHist.set(id, h);
      if (h.cells[h.cells.length - 1] !== cell) {
        if (h.cells.length >= 2 && h.cells[h.cells.length - 2] === cell) h.reversals.push(t);
        h.cells.push(cell);
        if (h.cells.length > 3) h.cells.shift();
        const windowFrom = t - cfg.movement.reversalWindowMins * 60;
        h.reversals = h.reversals.filter((x) => x >= windowFrom);
        if (h.reversals.length >= cfg.movement.reversals && t > h.flaggedUntil) {
          flag("movement.oscillating", id, t, `${name(id)} reversed ${h.reversals.length} times in ${cfg.movement.reversalWindowMins}m near ${p.atPoint ?? p.roomId} while ${doingNow(p)}`);
          h.flaggedUntil = t + cfg.movement.reversalWindowMins * 60;
        }
      }
    }
  }

  function doingNow(p: Person): string {
    if (p.resident) return p.resident.busyTaskId ? (w.tasks.get(p.resident.busyTaskId)?.label ?? "busy") : p.resident.inBed ? "in bed" : "no task";
    if (p.staff) {
      const task = p.staff.taskId ? w.tasks.get(p.staff.taskId) : undefined;
      if (task) return task.status === "open" && task.assigned.length < task.staffNeeded ? `holding "${task.label}" for a partner` : `"${task.label}"`;
      return p.staff.duty === "on_shift" ? "free at post" : p.staff.duty;
    }
    if (p.visitor) return `visitor ${p.visitor.phase}`;
    return "-";
  }

  function endStationary(id: string, st: { from: number; where: string; doing: string }, t: number): void {
    const mins = m(t - st.from);
    if (mins >= cfg.movement.stationaryMins) flag(st.where.startsWith("doorway") ? "movement.stuck_in_doorway" : "movement.stationary_in_corridor", id, st.from, `${name(id)} still ${mins}m in ${st.where} from ${hm(st.from)}, ${st.doing}`);
  }

  // ------------------------------------------------------------ every minute
  function onMinute(): void {
    const t = w.t;
    const s = timeOfDay(t);
    for (const r of residents) {
      const res = r.resident!;
      const d = resDay(r.id, t);
      d.minutes += 1;
      const where = whereIs(r);
      d.where[where] = (d.where[where] ?? 0) + 1;
      if (r.onMap) {
        if (r.roomId) d.roomsVisited.add(r.roomId);
        const bed = w.points.get(res.data.room)!;
        const dist = Math.hypot(r.x - bed.x, r.y - bed.y);
        if (!(cfg.movement.ignoreWcTrips && onWcTrip(r))) {
          d.furthestM = Math.max(d.furthestM, dist);
          if (dist > cfg.movement.bedAreaMetres) d.leftBedArea = true;
        }
      }

      // Needs: time high, peaks, drinks and long spells above the flag level.
      const prev = prevNeeds.get(r.id);
      for (const n of NEEDS) {
        const v = res.needs[n];
        if (prev && v < prev[n] - 1e-9) lastRelief.get(r.id)![n] = t;
        if (!r.onMap) continue;
        if (v > cfg.needs.highAt) d.highMins[n] += 1;
        if (v > d.peak[n].v) d.peak[n] = { v, t, cause: `${situation(r, n)}; last relief ${hm(lastRelief.get(r.id)![n])}` };
        if (n === "fatigue") continue;
        const key = `${r.id}:${n}`;
        const ep = highEpisodes.get(key);
        if (v > cfg.needs.flagAbove) {
          if (!ep) highEpisodes.set(key, { from: t, peak: v, peakT: t, startCause: situation(r, n), peakCause: situation(r, n) });
          else if (v > ep.peak) Object.assign(ep, { peak: v, peakT: t, peakCause: situation(r, n) });
        } else if (ep) {
          closeHigh(r, n, ep, t);
          highEpisodes.delete(key);
        }
      }
      prevNeeds.set(r.id, { ...res.needs });

      // A drink left by the bed (or owed): when it's drunk.
      const left = leftDrinks.get(r.id);
      const pending = res.drinkLeftT !== null || res.drinkOwed || res.drinkStale;
      if (left && !pending) {
        const dd = resDay(r.id, left.t).drinks[left.round as Round];
        if (dd && !dd.status.includes(",")) dd.status = `${dd.status.startsWith("owed") ? "owed, given" : "left, drunk"} ${hm(t)}`;
        leftDrinks.delete(r.id);
      } else if (left && !left.flagged && t - left.t >= cfg.drinks.leftUndrunkMins * 60) {
        left.flagged = true;
        flag("drinks.left_not_drunk", r.id, left.t, `${first(r)}'s ${left.round} drink (${hm(left.t)}) still by the bed ${cfg.drinks.leftUndrunkMins}m later (${situation(r)})`);
      }

      // In bed by day.
      if (r.onMap && !res.data.care.bed_bound) {
        const daytime = s >= tod(cfg.inBed.dayFrom) && s < tod(cfg.inBed.dayUntil);
        const reason = !!res.fall || res.postFallUntil > t;
        const ep = inBedEpisode.get(r.id);
        if (daytime && res.inBed && !reason) {
          if (!ep) inBedEpisode.set(r.id, { from: t, why: `${res.morningDone ? "morning care done" : "morning care not done"}; ${situation(r)}` });
        } else if (ep) {
          const mins = m(t - ep.from);
          if (mins >= cfg.inBed.minMins) flag("resident.in_bed_by_day", r.id, ep.from, `${first(r)} in bed ${hm(ep.from)}-${hm(t)} (${mins}m): ${ep.why}`);
          inBedEpisode.delete(r.id);
        }
      }

      // Checks: gap since the last time staff saw them, against the care plan.
      const ce = checkEp.get(r.id);
      if (!ce || ce.last !== res.lastCheckedT) {
        if (ce) closeCheck(r, ce, t);
        const night = isNight(res.lastCheckedT);
        const interval = res.lastCheckedT < res.postFallUntil ? 30 : night ? res.data.care.check_interval_mins.night : res.data.care.check_interval_mins.day;
        checkEp.set(r.id, { last: res.lastCheckedT, interval, night, max: 0 });
      }
      const ce2 = checkEp.get(r.id)!;
      if (r.onMap) ce2.max = Math.max(ce2.max, m(t - ce2.last));

      // Turns: while in bed, against the repositioning plan.
      const every = res.data.care.reposition_interval_mins;
      if (every.day || every.night) {
        const te = turnEp.get(r.id);
        if (!te || te.last !== res.lastTurnedT || !res.inBed) {
          if (te) closeTurn(r, te);
          turnEp.delete(r.id);
          if (res.inBed && r.onMap) {
            const interval = (isNight(res.lastTurnedT) ? every.night : every.day) ?? every.night ?? every.day!;
            turnEp.set(r.id, { last: res.lastTurnedT, interval, max: 0 });
          }
        }
        const te2 = turnEp.get(r.id);
        if (te2) te2.max = Math.max(te2.max, m(t - te2.last));
      }
    }

    // End-of-life comfort care (Dennis): gap between mouth care and sips, against the care plan.
    for (const r of residents) {
      const every = r.resident!.data.care.mouth_care_interval_mins;
      if (!every || !r.onMap) continue;
      const last = r.resident!.lastMouthCareT;
      const ep = mouthEp.get(r.id);
      if (ep && ep.last !== last) closeMouth(r, ep, every);
      if (!ep || ep.last !== last) mouthEp.set(r.id, { last, max: 0 });
      const cur = mouthEp.get(r.id)!;
      cur.max = Math.max(cur.max, m(t - cur.last));
    }

    // Staff free (or on an idle activity) while a resident has a high need.
    const needy = residents
      .filter((r) => r.onMap && !r.resident!.asleep && !r.resident!.busyTaskId)
      .flatMap((r) =>
        (cfg.staff.actionableNeeds as readonly NeedName[])
          .filter((n) => r.resident!.needs[n] > cfg.staff.needAbove && !(cfg.staff.idleNeedExempt[r.id] ?? []).includes(n))
          .map((n) => ({ r, n, v: r.resident!.needs[n] })),
      )
      .sort((a, b) => b.v - a.v);
    for (const id of w.order) {
      const p = w.people.get(id)!;
      if (!p.onMap || !p.staff || !isCareStaff(p) || p.kind === "external" || p.staff.duty !== "on_shift") continue;
      const rec = shiftRec(p);
      if (!rec) continue;
      const task = p.staff.taskId ? w.tasks.get(p.staff.taskId) : undefined;
      const idle = (!task || task.kind === "idle") && !p.move;
      if (idle && needy.length > 0) {
        const top = needy[0]!;
        const label = `${first(top.r)} ${top.n} ${top.v.toFixed(2)} (${situation(top.r, top.n)})`;
        if (!rec.idleStreak) rec.idleStreak = { from: t, worst: label, worstV: top.v };
        else if (top.v > rec.idleStreak.worstV) Object.assign(rec.idleStreak, { worst: label, worstV: top.v });
      } else if (rec.idleStreak) {
        closeIdle(p, rec, t);
      }
    }

    // Two people standing on the same spot.
    const here = w.order.map((id) => w.people.get(id)!).filter((p) => p.onMap && !p.move);
    const now = new Set<string>();
    for (let i = 0; i < here.length; i++)
      for (let j = i + 1; j < here.length; j++) {
        const a = here[i]!;
        const b = here[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) >= cfg.movement.samePlaceMetres) continue;
        const key = `${a.id}|${b.id}`;
        now.add(key);
        if (!samePlace.has(key)) samePlace.set(key, { from: t, where: `${a.atPoint ?? a.roomId} (${doingNow(a)} / ${doingNow(b)})` });
      }
    for (const [key, sp] of samePlace) {
      if (now.has(key)) continue;
      const mins = m(t - sp.from);
      const [a, b] = key.split("|");
      if (mins >= cfg.movement.samePlaceMins) flag("movement.same_spot", a!, sp.from, `${name(a!)} and ${name(b!)} on the same spot ${mins}m from ${hm(sp.from)} at ${sp.where}`);
      samePlace.delete(key);
    }
  }

  function closeHigh(r: Person, n: NeedName, ep: { from: number; peak: number; peakT: number; startCause: string; peakCause: string }, t: number): void {
    const mins = m(t - ep.from);
    if (mins > cfg.needs.flagAfterMins)
      flag(`need.${n}_over_${cfg.needs.flagAbove}`, r.id, ep.from, `${first(r)} ${n} > ${cfg.needs.flagAbove} for ${mins}m from ${hm(ep.from)} (peak ${ep.peak.toFixed(2)} at ${hm(ep.peakT)}). At start: ${ep.startCause}. At peak: ${ep.peakCause}`);
  }

  function closeCheck(r: Person, ce: { last: number; interval: number; night: boolean; max: number }, t: number): void {
    const d = resDay(r.id, t);
    const slot = ce.night ? d.checkGap.night : d.checkGap.day;
    if (ce.max > slot[0]) (slot[0] = ce.max), (slot[1] = ce.interval);
    if (ce.max > ce.interval) flag(`checks.gap_over_plan_${ce.night ? "night" : "day"}`, r.id, ce.last, `${first(r)} unseen ${ce.max}m from ${hm(ce.last)} (plan ${ce.interval}m)`);
  }

  function closeTurn(r: Person, te: { last: number; interval: number; max: number }): void {
    const d = resDay(r.id, te.last + te.max * 60);
    if (!d.turnGap || te.max > d.turnGap[0]) d.turnGap = [te.max, te.interval];
    if (te.max > te.interval) flag("turns.gap_over_plan", r.id, te.last, `${first(r)} not turned for ${te.max}m from ${hm(te.last)} (plan ${te.interval}m)`);
  }

  function closeMouth(r: Person, ep: { last: number; max: number }, every: number): void {
    const d = resDay(r.id, ep.last + ep.max * 60);
    if (!d.mouthCareGap || ep.max > d.mouthCareGap[0]) d.mouthCareGap = [ep.max, every];
    if (ep.max > every) flag("comfort.mouth_care_gap", r.id, ep.last, `${first(r)} without mouth care or sips for ${ep.max}m from ${hm(ep.last)} (plan ${every}m)`);
  }

  function closeIdle(p: Person, rec: ShiftRec, t: number): void {
    const st = rec.idleStreak!;
    rec.idleStreak = null;
    const mins = m(t - st.from);
    if (mins > cfg.staff.idleWhileNeedMins) flag("staff.idle_while_resident_needs", p.id, st.from, `${p.name} free/idle ${mins}m from ${hm(st.from)} while ${st.worst}`);
  }

  // ------------------------------------------------------------ run
  const ticks = Math.round((hours * 3600) / 5);
  for (let i = 0; i < ticks; i++) {
    for (const e of sim.step()) onEvent(e);
    onTick();
    if (w.t % 60 === 0) onMinute();
  }
  const endT = w.t;

  // Close anything still open at the end.
  for (const r of residents) {
    for (const n of NEEDS) {
      const ep = highEpisodes.get(`${r.id}:${n}`);
      if (ep) closeHigh(r, n, ep, endT);
    }
    const ce = checkEp.get(r.id);
    if (ce && r.onMap) closeCheck(r, ce, endT);
    const te = turnEp.get(r.id);
    if (te) closeTurn(r, te);
    const me = mouthEp.get(r.id);
    if (me) closeMouth(r, me, r.resident!.data.care.mouth_care_interval_mins!);
  }
  for (const [id, st] of stationary) endStationary(id, st, endT);
  for (const id of openRequests) {
    const info = tasks.get(id)!;
    const d = resDay(info.residentId!, info.createdT);
    d.longestWait = Math.max(d.longestWait, m(endT - info.createdT));
  }

  // ------------------------------------------------------------ day-level checks
  const fullDay = (d: ResDay) => d.minutes >= 20 * 60;
  for (const r of residents) {
    const res = r.resident!;
    for (const [k, d] of resDays.get(r.id)!) {
      const dayStart = k * 86400 + dayOff;
      const at = (clock: string) => dayStart - dayOff + clockToSeconds(clock) + (clockToSeconds(clock) < dayOff ? 86400 : 0);
      // Morning.
      if (d.wakeT !== null) {
        const drink = d.firstDrinkT;
        // Dennis is on a comfort plan: his sips are judged against his mouth-care interval (comfort.mouth_care_gap).
        const comfortPlan = res.data.care.eating_support === "mouth_care_only";
        if (!comfortPlan && (drink === null || drink - d.wakeT > cfg.morning.firstDrinkWithinMins * 60))
          flag("morning.late_first_drink", r.id, d.wakeT, `${first(r)} woke ${hm(d.wakeT)}, first drink ${drink ? `${hm(drink)} (+${m(drink - d.wakeT)}m)` : "none that morning"}`);
        const food = d.firstFoodT;
        const bk = d.meals.breakfast;
        if (res.data.care.eating_support !== "mouth_care_only" && (food === null || food - d.wakeT > cfg.morning.firstFoodWithinMins * 60))
          flag("morning.late_first_food", r.id, d.wakeT, `${first(r)} woke ${hm(d.wakeT)}, first food ${food ? `${hm(food)} (+${m(food - d.wakeT)}m)` : "none that morning"}; breakfast ${bk ? hm(bk) : "not served"}, morning care ${d.morningStartT ? hm(d.morningStartT) : "never"}`);
      }
      // Meals (not for Dennis, on end-of-life comfort care: see the mouth care check).
      for (const meal of MEALS) {
        if (res.data.care.eating_support === "mouth_care_only") break;
        const [from, until] = cfg.meals.windows[meal];
        const endOfWindow = at(until);
        if (endOfWindow > endT || at(from) < w.startT) continue;
        const served = d.meals[meal];
        if (served === undefined)
          flag("meals.skipped_unlogged", r.id, at(from), `${first(r)} had no ${meal} (${formatSimTime(at(from)).slice(0, 3)}) and nothing logged why; morning care ${d.morningStartT ? `started ${hm(d.morningStartT)}` : "never started"}`);
        else if (served > endOfWindow) flag("meals.served_late", r.id, served, `${first(r)}'s ${meal} served ${hm(served)}, after the ${until} window end`);
      }
      // Drinks rounds.
      for (const round of Object.keys(cfg.drinks.rounds) as Round[]) {
        const due = at(cfg.drinks.rounds[round]);
        if (due + 3600 > endT || due < w.startT) continue;
        if (!d.drinks[round]) flag("drinks.round_missed", r.id, due, `${first(r)} got nothing on the ${round} round (${hm(due)})`);
      }
      // Never left the bed area.
      if (fullDay(d) && !d.leftBedArea && !(cfg.movement.bedAreaExempt as readonly string[]).includes(r.id))
        flag("resident.never_left_bed_area", r.id, dayStart, `${first(r)} stayed within ${cfg.movement.bedAreaMetres} m of the bed all day ${dayLabel(k)} (furthest ${d.furthestM.toFixed(1)} m; rooms: ${[...d.roomsVisited].join(", ")})`);
    }
  }

  // Morning care order vs when each resident was ready.
  for (const [k, rows] of morningOrder) {
    const started = rows.filter((r) => r.startT !== null);
    const inversions: string[] = [];
    for (const a of started)
      for (const b of started)
        if (a.dueT + cfg.careOrder.toleranceMins * 60 <= b.dueT && a.startT! > b.startT!)
          inversions.push(`${first(w.people.get(a.id)!)} (ready ${hm(a.dueT)}, started ${hm(a.startT!)}) after ${first(w.people.get(b.id)!)} (ready ${hm(b.dueT)}, started ${hm(b.startT!)})`);
    if (inversions.length) flag("morning.care_out_of_wake_order", "wing", k * 86400 + dayOff, `${dayLabel(k)}: ${inversions.join("; ")}`);
  }

  // Staff shifts: walking share, breaks.
  for (const rec of shifts.values()) {
    const p = { id: rec.personId, name: rec.name };
    const total = Object.values(rec.ticks).reduce((a, b) => a + b, 0);
    if (total < 60 * 12) continue; // under an hour seen (the run started or ended mid-shift)
    const walking = (rec.ticks.walking ?? 0) / total;
    if (walking > cfg.staff.walkingShare)
      flag("staff.walking_over_share", p.id, rec.a.startT, `${p.name} walked ${(100 * walking).toFixed(0)}% of ${rec.a.shift} ${formatSimTime(rec.a.startT).slice(0, 10)} (top: ${topPurposes(rec.walkingFor, total)})`);
    const sawWholeShift = rec.a.startT >= w.startT && rec.a.endT <= endT;
    if (sawWholeShift && rec.breakStartT === null) flag("staff.break_skipped", p.id, rec.a.startT, `${p.name} had no break on ${rec.a.shift} ${formatSimTime(rec.a.startT).slice(0, 10)}`);
  }

  // Medication.
  for (const r of rounds.values()) {
    const day = formatSimTime(r.dueT).slice(0, 10);
    if (r.startT !== null && r.startT - r.dueT > cfg.meds.roundStartLateMins * 60)
      flag("meds.round_started_late", "wing", r.dueT, `${day} ${r.round} round started ${hm(r.startT)} (+${m(r.startT - r.dueT)}m) by ${name(r.giver ?? "?")}`);
    const why = r.interruptions.length ? r.interruptions.map((i) => `${hm(i.t)} ${i.reason}`).join("; ") : "no interruptions";
    for (const l of r.late) flag("meds.late_dose", l.id, r.dueT, `${day} ${r.round} dose ${l.mins}m late (round started ${r.startT ? hm(r.startT) : "?"}; ${why})`);
    for (const id of r.missed) flag("meds.missed_dose", id, r.dueT, `${day} ${r.round} dose missed (${why})`);
    if (r.endT !== null) for (const id of r.expected) if (!r.given.has(id)) flag("meds.dose_not_recorded", id, r.dueT, `${day} ${r.round}: no dose or miss logged for ${first(w.people.get(id)!)}`);
  }

  // Drinks rounds starting late.
  for (const dr of drinkRounds.values()) {
    if (dr.startT !== null && dr.startT - dr.createdT > cfg.drinks.startLateMins * 60)
      flag("drinks.round_started_late", "wing", dr.createdT, `${formatSimTime(dr.createdT).slice(0, 10)} ${dr.round} round started ${hm(dr.startT)} (+${m(dr.startT - dr.createdT)}m)`);
  }

  // ------------------------------------------------------------ report
  const L: string[] = [];
  const flagsOf = (subject: string) => flags.filter((f) => f.subject === subject).sort((a, b) => a.t - b.t);
  L.push(`BEHAVIOUR AUDIT  seed ${seed}, ${hours} h, ${formatSimTime(w.startT)} to ${formatSimTime(endT)}`);
  L.push(`Care days run ${cfg.careDayStartsAt} to ${cfg.careDayStartsAt}. Thresholds: scripts/audit.config.ts`);

  L.push("", "==================== RESIDENTS ====================");
  const weeks = hours / 168;
  for (const r of residents) {
    const res = r.resident!;
    L.push("", `-- ${r.name} (${r.id}) wakes ${res.data.routine.wake ?? "-"}, bed ${res.data.routine.bed ?? "-"}; visits: ${visits.get(r.id)} (${(visits.get(r.id)! / weeks).toFixed(1)} a week)`);
    for (const [k, d] of [...resDays.get(r.id)!].sort((a, b) => a[0] - b[0])) {
      const rel = (t: number | null | undefined) => (t == null ? "-" : d.wakeT !== null ? `${hm(t)} (+${m(t - d.wakeT)}m)` : hm(t));
      L.push(`  ${dayLabel(k)}${d.minutes < 20 * 60 ? ` (partial, ${hmins(d.minutes)})` : ""}`);
      if (d.wakeT !== null || d.morningStartT !== null) L.push(`     morning: woke ${d.wakeT ? hm(d.wakeT) : "-"}, first drink ${rel(d.firstDrinkT)}, tea ${rel(d.teaT)}, first food ${rel(d.firstFoodT)}, care ${rel(d.morningStartT)}, breakfast ${rel(d.meals.breakfast)}`);
      const high = NEEDS.filter((n) => d.highMins[n] > 0).map((n) => `${n} ${hmins(d.highMins[n])}`);
      L.push(`     needs > ${cfg.needs.highAt}: ${high.length ? high.join(", ") : "none"}`);
      for (const n of NEEDS) {
        const pk = d.peak[n];
        if (pk.v > cfg.needs.highAt) L.push(`       peak ${n} ${pk.v.toFixed(2)} at ${hm(pk.t)}: ${pk.cause}`);
      }
      L.push(`     meals: ${MEALS.map((ml) => `${ml} ${d.meals[ml] ? hm(d.meals[ml]!) : "-"}`).join(", ")}   drinks: ${(Object.keys(cfg.drinks.rounds) as Round[]).map((rd) => `${cfg.drinks.rounds[rd]} ${d.drinks[rd]?.status ?? "-"}`).join(", ")}`);
      const order = ["bed", "chair", "bedroom", "wc", "lounge", "lounge (dozing)", "Corridor", "waiting area", "Reception", "away"];
      const where = Object.entries(d.where).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([k2, v]) => `${k2} ${hmins(v)}`);
      L.push(`     where: ${where.join(", ")}; furthest from bed ${d.furthestM.toFixed(1)} m${d.dozes ? `; dozed in the Lounge ${d.dozes}x` : ""}${d.mouthCareGap ? `; longest without mouth care ${d.mouthCareGap[0]}m (plan ${d.mouthCareGap[1]})` : ""}`);
      const cg = (x: [number, number]) => (x[0] ? `${x[0]}m (plan ${x[1]})` : "-");
      L.push(`     longest unseen: day ${cg(d.checkGap.day)}, night ${cg(d.checkGap.night)}${d.turnGap ? `;  longest without a turn ${d.turnGap[0]}m (plan ${d.turnGap[1]})` : ""};  requests ${d.requests}, longest wait ${d.longestWait}m`);
    }
    const fs = flagsOf(r.id);
    L.push(`  flags (${fs.length}):`);
    for (const f of fs) L.push(`    [${f.type}] ${formatSimTime(f.t).slice(0, 3)} ${f.detail}`);
  }

  L.push("", "==================== STAFF (per shift) ====================");
  const cats = ["care", "rounds", "idle activity", "break", "walking", "waiting for partner", "handover", "free (at post)"];
  L.push(`  ${"who".padEnd(18)} ${"shift".padEnd(18)} ${"hours".padStart(5)}  ${cats.map((c) => c.split(" ")[0]!.slice(0, 7).padStart(7)).join("")}  over  break`);
  const recs = [...shifts.values()].sort((a, b) => a.a.startT - b.a.startT || a.personId.localeCompare(b.personId));
  for (const rec of recs) {
    const p = { name: rec.name };
    const total = Object.values(rec.ticks).reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const pct = cats.map((c) => `${((100 * (rec.ticks[c] ?? 0)) / total).toFixed(0)}%`.padStart(7)).join("");
    const brk = rec.breakStartT ? `${hm(rec.breakStartT)}-${rec.breakEndT ? hm(rec.breakEndT) : "?"} (${m(rec.breakTicks * 5)}m resting)` : "none";
    L.push(`  ${p.name.slice(0, 18).padEnd(18)} ${`${rec.a.shift} ${formatSimTime(rec.a.startT).slice(0, 3)} ${hm(rec.a.startT)}`.padEnd(18)} ${(total / 720).toFixed(1).padStart(5)}  ${pct}  ${String(m(rec.overtimeTicks * 5)).padStart(3)}m  ${brk}`);
    if ((rec.ticks.walking ?? 0) > 0) L.push(`  ${"".padEnd(38)} walking for: ${topPurposes(rec.walkingFor, rec.ticks.walking!)}`);
  }
  const staffIds = [...new Set(recs.map((r) => r.personId))];
  L.push("", "  staff flags:");
  for (const id of staffIds) for (const f of flagsOf(id)) L.push(`    [${f.type}] ${formatSimTime(f.t).slice(0, 3)} ${f.detail}`);

  L.push("", "==================== MORNING CARE ORDER ====================");
  for (const [k, rows] of [...morningOrder].sort((a, b) => a[0] - b[0])) {
    const sorted = [...rows].sort((a, b) => (a.startT ?? Infinity) - (b.startT ?? Infinity));
    L.push(`  ${dayLabel(k)}: ${sorted.map((r) => `${first(w.people.get(r.id)!)} ${r.startT ? hm(r.startT) : "-"} (ready ${hm(r.dueT)})`).join(" -> ")}`);
  }

  L.push("", "==================== MEDICATION ====================");
  for (const r of rounds.values()) {
    const late = r.late.length ? `, late: ${r.late.map((l) => `${first(w.people.get(l.id)!)} ${l.mins}m`).join(" ")}` : "";
    const missed = r.missed.length ? `, missed: ${r.missed.map((id) => first(w.people.get(id)!)).join(" ")}` : "";
    const ints = r.interruptions.length ? `, interrupted: ${r.interruptions.map((i) => `${hm(i.t)} ${i.reason}`).join("; ")}` : "";
    L.push(`  ${formatSimTime(r.dueT).slice(0, 10)} ${r.round} by ${name(r.giver ?? "?")}: start ${r.startT ? `+${m(r.startT - r.dueT)}m` : "never"}, end ${r.endT ? hm(r.endT) : "-"}${late}${missed}${ints}`);
  }

  L.push("", "==================== MOVEMENT AND WING ====================");
  const other = flags.filter((f) => !residents.some((r) => r.id === f.subject) && !staffIds.includes(f.subject)).sort((a, b) => a.t - b.t);
  for (const f of other) L.push(`    [${f.type}] ${formatSimTime(f.t).slice(0, 3)} ${f.detail}`);
  const movement = flags.filter((f) => f.type.startsWith("movement.") && (residents.some((r) => r.id === f.subject) || staffIds.includes(f.subject)));
  L.push(`  (${movement.length} movement flags for residents and staff are listed under each person above)`);

  L.push("", "==================== FLAG SUMMARY ====================");
  for (const line of summarise(flags)) L.push(line);
  return { lines: L, flags };
}

function topPurposes(by: Record<string, number>, total: number): string {
  return Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k} ${((100 * v) / total).toFixed(0)}%`)
    .join(", ");
}

export function summarise(flags: Flag[]): string[] {
  const byType = new Map<string, Flag[]>();
  for (const f of flags) byType.set(f.type, [...(byType.get(f.type) ?? []), f]);
  const out: string[] = [`  ${"count".padStart(5)}  type`];
  for (const [type, list] of [...byType].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    const who = new Map<string, number>();
    for (const f of list) who.set(f.subject, (who.get(f.subject) ?? 0) + 1);
    out.push(`  ${String(list.length).padStart(5)}  ${type.padEnd(38)} ${[...who].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/^(res|stf|agy|vis)_/, "")} ${v}`).join(", ")}`);
  }
  return out;
}

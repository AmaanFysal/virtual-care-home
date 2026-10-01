// What each person is doing and how hard (v1.0-testbed): an activity from what the engine already
// knows (posture, sleep, walking, the task and its step), and its MET from data/activities.json
// (the 2024 Compendium of Physical Activities). Reads the world only; draws no random numbers.

import type { Activity, ActivityEntry, Intensity, PersonActivity } from "@vch/shared-types";
import type { Person, Task, World } from "./state.js";

/** Care at the resident that is washing, dressing, changing or turning them. */
const PERSONAL = new Set(["morning", "bedtime", "pad_change", "reposition", "comfort"]);
const DESK_POINTS = new Set(["Reception.DeskStaff", "Reception.Office", "Reception.Desk"]);

function taskOf(world: World, p: Person): Task | undefined {
  const id = p.staff?.taskId ?? p.resident?.busyTaskId ?? null;
  return id ? world.tasks.get(id) : undefined;
}

/** A hoist transfer is instant in the engine: it shows on the tick it happened (noted by the building observer). */
function hoistedNow(world: World, residentId: string): boolean {
  return !!world.building?.hoisted.has(residentId);
}

function residentActivity(world: World, p: Person): Activity {
  const res = p.resident!;
  if (res.fall || p.posture === "on_floor") return "on_floor";
  if (hoistedNow(world, p.id)) return "being_hoisted";
  if (p.move) return p.speed === 0 ? "in_wheelchair" : "walking";
  if (res.asleep) return "sleeping";
  const task = taskOf(world, p);
  if (task?.kind === "self_toilet" && task.bt.node === "on the toilet") return "toileting";
  if (task?.kind === "assist" && task.bt.node === "at the WC") return "toileting";
  // Care being given to them by staff (their own task may be another): look for staff with them.
  for (const t of world.tasks.values()) {
    if (t.residentId !== p.id || t.status !== "active" || t.bt.node !== "care") continue;
    const care = String(t.data.care ?? "");
    if (t.kind === "care" && (care === "meal" || care === "tea")) return "eating";
    if ((t.kind === "care" && PERSONAL.has(care)) || (t.kind === "assist" && t.need === "toileting")) return "receiving_care";
  }
  if (res.loungeActivity === "tv") return "watching_tv";
  if (res.loungeActivity) return res.loungeActivity;
  if (res.inBed) return "lying";
  return p.posture === "standing" ? "standing" : "sitting";
}

function staffTaskActivity(world: World, p: Person, task: Task): Activity {
  const resident = task.residentId ? world.people.get(task.residentId) : undefined;
  if (p.move) {
    const escorting = !!p.move.with && resident?.speed === 0 && resident.move;
    return escorting ? "pushing_wheelchair" : "walking";
  }
  const care = String(task.data.care ?? "");
  switch (task.kind) {
    case "care":
      if (care === "meal") return resident?.resident?.data.care.eating_support === "assisted" ? "assisting_meal" : "serving";
      if (care === "tea") return "serving";
      if (care === "check") return "checking";
      if (care === "escort") return "standing";
      if (PERSONAL.has(care)) return resident && hoistedNow(world, resident.id) ? "hoisting" : "personal_care";
      return "standing";
    case "assist":
      if (task.need === "toileting") return resident && hoistedNow(world, resident.id) ? "hoisting" : "personal_care";
      if (task.need === "hunger" || task.need === "thirst") return "serving";
      return "talking";
    case "round":
      return "serving";
    case "med_round":
      return "med_round";
    case "fall":
    case "hospital_transfer":
      return "fall_response";
    case "handover":
    case "briefing":
      return "handover";
    case "break":
      return "on_break";
    case "lounge_check":
      return "checking";
    case "let_in":
      return "standing";
    case "idle": {
      const what = String(task.data.activity);
      if (what === "notes") return "desk_work";
      if (what === "tidy" || what === "restock") return "tidying";
      if (what === "sit_with") return "talking";
      if (what === "checks") return "checking";
      return "standing";
    }
    default:
      return "standing";
  }
}

function otherActivity(world: World, p: Person): Activity {
  if (p.visitor) {
    if (p.move) return "walking";
    if (p.visitor.phase === "visiting") return "visiting";
    return p.posture === "sitting" ? "sitting" : "standing";
  }
  if (world.session?.staffId === p.id && !p.move) return "leading_activity";
  const task = taskOf(world, p);
  if (task) return staffTaskActivity(world, p, task);
  if (p.move) return "walking";
  if (p.posture === "sitting") return p.atPoint && DESK_POINTS.has(p.atPoint) ? "desk_work" : "sitting";
  return "standing";
}

/** The first entry that fits: by walking aid, speed, or whether they're in bed. */
function entryFor(entries: ActivityEntry[], p: Person): ActivityEntry {
  const speed = p.move?.pace ?? p.speed;
  const aid = p.resident?.data.mobility.aid ?? "";
  return (
    entries.find(
      (e) =>
        (e.aid === undefined || aid.includes(e.aid)) &&
        (e.below_mps === undefined || speed < e.below_mps) &&
        (e.in_bed === undefined || e.in_bed === !!p.resident?.inBed),
    ) ?? entries[entries.length - 1]!
  );
}

export function intensityOf(met: number): Intensity {
  return met <= 1.5 ? "sedentary" : met < 3 ? "light" : met < 6 ? "moderate" : "vigorous";
}

/** What `p` is doing now, with its MET. Only for people on the map. */
export function activityOf(world: World, p: Person): PersonActivity {
  const activity = p.resident ? residentActivity(world, p) : otherActivity(world, p);
  const table = p.resident ? world.data.activities.resident : world.data.activities.other;
  const entry = entryFor(table[activity]!, p);
  return {
    personId: p.id,
    kind: p.kind,
    roomId: p.roomId,
    x: Math.round(p.x * 1000) / 1000,
    y: Math.round(p.y * 1000) / 1000,
    activity,
    met: entry.met,
    intensity: intensityOf(entry.met),
    book: entry.book,
    code: entry.code,
  };
}

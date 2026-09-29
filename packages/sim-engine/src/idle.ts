// Idle behaviour (M7): a care worker with nothing to do picks a weighted, low-priority activity
// rather than standing in the corridor: writing care notes, tidying a resident's room,
// restocking the en-suite, or sitting with a resident who wants company (which meets some of
// their social need), or keeping an eye on the Lounge while residents are there. Any real task or
// help request interrupts it at once (`pullOff` simply drops it), and all of these happen on the
// floor. The handover's floor cover does a round of checks instead (offering drinks), so they
// stay on the floor and out of the staff room; so does the floating night carer while she waits
// on site for a turn.

import { act, leaf, seq, type BtNode } from "./bt.js";
import { newBtState } from "./bt.js";
import { emit } from "./emit.js";
import { needsHelpToDrink } from "./needs.js";
import { isNight } from "./nightcover.js";
import { isCareStaff, isNurse, type Person, type Task, type World } from "./state.js";
import { besideThem, goTo, lower, markChecked, setBadges, type Ctx } from "./trees.js";

type Activity = "notes" | "tidy" | "restock" | "sit_with" | "supervise" | "checks";

const LABEL: Record<Activity, string> = { notes: "Writing care notes", tidy: "Tidying", restock: "Restocking", sit_with: "Sitting with", supervise: "Keeping an eye on the Lounge", checks: "Checking on" };
/** Weights before adjustment; sitting with someone scales with how much they want company. */
const WEIGHT = { notes: 3, tidy: 2, restock: 1, sit_with: 8, supervise: 6 };
/** A check round offers a drink to anyone awake this thirsty. */
const OFFER_DRINK_FROM = 0.3;
/** A resident wanting company at least this much is worth sitting with. */
const SIT_WITH_FROM = 0.4;
const SOCIAL_RELIEF_PER_MIN = 1 / 25;
const NOTES_POINTS = ["Reception.Desk", "Reception.Office"];
/** Restocking an en-suite is done standing beside the toilet, never on it. */
const WC_POINTS = ["Room1.WC.Stand", "Room2.WC.Stand"];

/** Someone the idle carer could sit with: awake, free, wanting company, not already accompanied. */
function wantsCompany(world: World): Person[] {
  const sitting = new Set([...world.tasks.values()].filter((t) => t.kind === "idle" && t.data.activity === "sit_with").map((t) => t.residentId));
  return world.order
    .map((id) => world.people.get(id)!)
    .filter((p) => {
      const res = p.resident;
      if (!res || !p.onMap || res.asleep || res.busyTaskId || res.fall || sitting.has(p.id)) return false;
      const visited = [...world.people.values()].some((v) => v.visitor?.residentId === p.id && v.visitor.phase === "visiting");
      return !visited && res.needs.social >= SIT_WITH_FROM;
    })
    .sort((a, b) => b.resident!.needs.social - a.resident!.needs.social || a.id.localeCompare(b.id));
}

function pick<T>(world: World, options: { value: T; weight: number }[]): T | null {
  const total = options.reduce((s, o) => s + o.weight, 0);
  if (total <= 0) return null;
  let roll = world.rng.decisions.next() * total;
  for (const o of options) {
    roll -= o.weight;
    if (roll < 0) return o.value;
  }
  return options[options.length - 1]!.value;
}

/** The resident unseen longest, for the floor cover's round of checks (not anyone already busy with staff). */
function unseenLongest(world: World): Person | null {
  const checking = new Set([...world.tasks.values()].filter((t) => t.kind === "idle" && t.data.activity === "checks").map((t) => t.residentId));
  const options = world.order
    .map((id) => world.people.get(id)!)
    .filter((r) => r.resident && r.onMap && !r.resident.fall && !r.resident.busyTaskId && !r.move && !checking.has(r.id));
  options.sort((a, b) => a.resident!.lastCheckedT - b.resident!.lastCheckedT || a.id.localeCompare(b.id));
  return options[0] ?? null;
}

/**
 * Gives a free carer something useful to do; returns false if they should just wait at their post.
 * `floorCover`: covering the floor during a handover, so only a round of checks.
 */
export function startIdleActivity(world: World, p: Person, floorCover = false): boolean {
  if (!isCareStaff(p)) return false;
  // The floating night carer, waiting on site for a turn, checks whoever is due next.
  const floating = p.id === world.data.rota.night_float.id;
  if (p.kind === "external" && !floating) return false;
  if (floorCover || floating) {
    const r = unseenLongest(world);
    if (!r) return false;
    return newIdleTask(world, p, { activity: "checks", residentId: r.id, point: besideThem(r)[0]! }, 2);
  }
  const night = isNight(world.t);
  const lonely = wantsCompany(world);
  const rooms = world.order
    .map((id) => world.people.get(id)!)
    .filter((r) => r.resident && r.onMap && !r.resident.inBed && !r.resident.busyTaskId);
  const options: { value: { activity: Activity; residentId: string | null; point: string }; weight: number }[] = [];
  options.push({ value: { activity: "notes", residentId: null, point: NOTES_POINTS[world.rng.decisions.int(0, 1)]! }, weight: WEIGHT.notes });
  if (!isNurse(p)) {
    if (!night && rooms.length > 0) {
      const r = rooms[world.rng.decisions.int(0, rooms.length - 1)]!;
      options.push({ value: { activity: "tidy", residentId: r.id, point: `${r.resident!.data.room}.Side2` }, weight: WEIGHT.tidy });
    }
    options.push({ value: { activity: "restock", residentId: null, point: WC_POINTS[world.rng.decisions.int(0, 1)]! }, weight: WEIGHT.restock });
    const r = lonely[0];
    if (r) {
      // Beside them: at their bedside, or next to wherever they are (the carer stands; the seat is theirs).
      const spot = r.resident!.inBed || !r.atPoint ? `${r.resident!.data.room}.Side` : r.atPoint;
      options.push({ value: { activity: "sit_with", residentId: r.id, point: spot }, weight: WEIGHT.sit_with * r.resident!.needs.social });
    }
    // Residents in the Lounge: someone keeps an eye on them (unless a carer is already there).
    const inLounge = world.order.some((id) => world.people.get(id)!.resident && world.people.get(id)!.roomId === "Lounge");
    const watched = world.order.some((id) => id !== p.id && world.people.get(id)!.roomId === "Lounge" && isCareStaff(world.people.get(id)!) && !world.people.get(id)!.move);
    if (inLounge && !watched) options.push({ value: { activity: "supervise", residentId: null, point: "Lounge.Post" }, weight: WEIGHT.supervise });
  }
  const choice = pick(world, options);
  if (!choice) return false;
  return newIdleTask(world, p, choice, choice.activity === "sit_with" ? 15 : world.rng.decisions.int(8, 15));
}

function newIdleTask(world: World, p: Person, choice: { activity: Activity; residentId: string | null; point: string }, mins: number): boolean {
  world.taskSeq += 1;
  const residentName = choice.residentId ? world.people.get(choice.residentId)!.name.split(" ")[0] : null;
  const named = choice.activity === "sit_with" || choice.activity === "checks";
  const task: Task = {
    id: `t${String(world.taskSeq).padStart(6, "0")}`,
    kind: "idle",
    label: named ? `${LABEL[choice.activity]} ${residentName}` : LABEL[choice.activity],
    residentId: named ? choice.residentId : null,
    need: null,
    createdT: world.t,
    startedT: null,
    staffNeeded: 1,
    femaleOnly: false,
    priority: 0,
    request: false,
    deadlineT: null,
    members: null,
    assigned: [p.id],
    status: "active",
    bt: newBtState(),
    data: { activity: choice.activity, point: choice.point, mins },
  };
  world.tasks.set(task.id, task);
  p.staff!.taskId = task.id;
  return true;
}

export const idleTree: BtNode<Ctx> = seq(
  "idle",
  goTo("go there", (c) => c.staff, (c) => [String(c.task.data.point)]),
  act("start", (c) => {
    c.task.startedT = c.world.t;
    setBadges(c.staff, [], c.task.label);
    if (!c.resident) return;
    const checks = c.task.data.activity === "checks";
    markChecked(c.world, c.resident, c.staff, checks);
    // A round of checks offers a drink to anyone awake and a bit thirsty.
    const res = c.resident.resident!;
    if (checks && !res.asleep && res.needs.thirst >= OFFER_DRINK_FROM && !needsHelpToDrink(res.data)) {
      lower(c.resident, "thirst", 0.5);
      res.fluidsMlToday += 150;
      emit(c.world, "drink.served", [c.resident.id, c.staff[0]!.id], { residentId: c.resident.id, round: "top_up", staffId: c.staff[0]!.id, outcome: "drunk" });
    }
  }),
  leaf("keep at it", (c, mem) => {
    if (mem.start === undefined) mem.start = c.world.t;
    const res = c.resident?.resident;
    if (res && c.world.t % 60 === 0) res.needs.social = Math.max(0, res.needs.social - SOCIAL_RELIEF_PER_MIN);
    // Company is over if the resident is taken off for care, falls asleep or leaves.
    if (res && (res.busyTaskId || res.asleep || !c.resident!.onMap)) return "success";
    return c.world.t - mem.start >= Number(c.task.data.mins) * 60 ? "success" : "running";
  }),
);

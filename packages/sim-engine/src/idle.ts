// Idle behaviour (M7): a care worker with nothing to do picks a weighted, low-priority activity
// rather than standing in the corridor: writing care notes, tidying a resident's room,
// restocking the en-suite, or sitting with a resident who wants company (which meets some of
// their social need). Any real task or help request interrupts it at once (`pullOff` simply
// drops it), and all of these happen on the floor. Only the handover floor cover and anyone
// holding a two-person task for a partner wait in the corridor.

import { act, leaf, seq, type BtNode } from "./bt.js";
import { newBtState } from "./bt.js";
import { isNight } from "./nightcover.js";
import { isCareStaff, isNurse, type Person, type Task, type World } from "./state.js";
import { goTo, markChecked, setBadges, type Ctx } from "./trees.js";

type Activity = "notes" | "tidy" | "restock" | "sit_with";

const LABEL: Record<Activity, string> = { notes: "Writing care notes", tidy: "Tidying", restock: "Restocking", sit_with: "Sitting with" };
/** Weights before adjustment; sitting with someone scales with how much they want company. */
const WEIGHT = { notes: 3, tidy: 2, restock: 1, sit_with: 8 };
/** A resident wanting company at least this much is worth sitting with. */
const SIT_WITH_FROM = 0.4;
const SOCIAL_RELIEF_PER_MIN = 1 / 25;
const NOTES_POINTS = ["Reception.Desk", "Reception.Office"];
const WC_POINTS = ["Room1.WC", "Room2.WC"];

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

/** Gives a free carer something useful to do; returns false if they should just wait at their post. */
export function startIdleActivity(world: World, p: Person): boolean {
  if (!isCareStaff(p) || p.kind === "external") return false;
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
      const spot = r.resident!.inBed ? `${r.resident!.data.room}.Side` : r.atPoint ?? `${r.resident!.data.room}.Chair`;
      options.push({ value: { activity: "sit_with", residentId: r.id, point: spot }, weight: WEIGHT.sit_with * r.resident!.needs.social });
    }
  }
  const choice = pick(world, options);
  if (!choice) return false;
  world.taskSeq += 1;
  const residentName = choice.residentId ? world.people.get(choice.residentId)!.name.split(" ")[0] : null;
  const task: Task = {
    id: `t${String(world.taskSeq).padStart(6, "0")}`,
    kind: "idle",
    label: choice.activity === "sit_with" ? `${LABEL.sit_with} ${residentName}` : LABEL[choice.activity],
    residentId: choice.activity === "sit_with" ? choice.residentId : null,
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
    data: { activity: choice.activity, point: choice.point, mins: choice.activity === "sit_with" ? 15 : world.rng.decisions.int(8, 15) },
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
    if (c.resident) markChecked(c.world, c.resident, c.staff, false);
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

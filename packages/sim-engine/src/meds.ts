// Medication rounds (docs/05 "Medication round", spec decision 9). The day RN gives the 08:00,
// 13:00 and 17:00 rounds; the late lead gives 21:00 before handover. A round gives time-critical
// medication first, then goes bed to bed, and can be interrupted (a fall, or an urgent request nobody else can take); it resumes where
// it stopped. Each interruption adds 5 points to the chance each remaining dose is missed
// (capped at 40%), following the CHUMS finding that interrupted rounds cause errors. A dose given
// more than 60 minutes after the round time is late. Nothing here is clinical advice.

import { clockToSeconds, timeOfDay } from "@vch/shared-types";
import { act, leaf, seq, type BtNode } from "./bt.js";
import { emit } from "./emit.js";
import { isCareStaff, onDuty, type Person, type World } from "./state.js";
import { newBtState } from "./bt.js";
import { begin, besideThem, markChecked, setBadges, type Ctx } from "./trees.js";
import { walkTo } from "./world/movement.js";
import { ppeMins } from "./infection.js";

const ROUNDS: { at: string; slot: string }[] = [
  { at: "08:00", slot: "rn_day.nurse" },
  { at: "13:00", slot: "rn_day.nurse" },
  { at: "17:00", slot: "rn_day.nurse" },
  { at: "21:00", slot: "late.lead" },
];
const MINUTES_PER_RESIDENT = 3;
const ERROR_PER_INTERRUPTION = 0.05;
const ERROR_CAP = 0.4;
const LATE_AFTER_MINS = 60;

export function isMedsTrained(p: Person): boolean {
  return !!p.staff?.competencies.includes("meds_trained");
}

/** Who gives a round: the slot holder on duty, or any meds-trained carer on duty. */
function giverFor(world: World, slot: string): Person | null {
  const holder = world.shifts.find((a) => a.slot === slot && a.started && !a.ended && world.people.get(a.personId)?.onMap);
  const person = holder ? world.people.get(holder.personId)! : null;
  if (person && isMedsTrained(person)) return person;
  return world.order.map((id) => world.people.get(id)!).find((p) => isCareStaff(p) && onDuty(p) && isMedsTrained(p)) ?? null;
}

export function medsMinute(world: World): void {
  // A round nobody could give at its time is given as soon as someone meds-trained is here (the on-call RN).
  if (world.pendingRounds.length > 0) {
    const giver = giverFor(world, "");
    if (giver) for (const p of world.pendingRounds.splice(0)) createRound(world, p.round, p.roundT, giver);
  }
  const tod = timeOfDay(world.t);
  for (const round of ROUNDS) {
    if (tod !== clockToSeconds(round.at)) continue;
    const giver = giverFor(world, round.slot);
    if (!giver) {
      // Nobody meds-trained on the wing (a scenario left a shift lead's slot uncovered, docs/10):
      // the on-call RN comes over from the main building (about 30 minutes) and gives it.
      emit(world, "med_round.no_giver", [], { round: round.at });
      world.pendingRounds.push({ round: round.at, roundT: world.t });
      if (world.onCallRn.status === "off") {
        world.onCallRn = { status: "coming", arriveT: world.t + world.rng.meds.int(25, 35) * 60, residentId: null };
        emit(world, "on_call_rn.called", [], { residentId: null, reason: `${round.at} medication round: nobody meds-trained on the wing` });
      }
      continue;
    }
    createRound(world, round.at, world.t, giver);
  }
}

function createRound(world: World, round: string, roundT: number, giver: Person): void {
  const queue = world.order
    .map((id) => world.people.get(id)!)
    .filter((p) => p.resident)
    // Time-critical medication first (Arthur's Parkinson's), then bed by bed.
    .sort((a, b) => Number(!!b.resident!.data.care.time_critical_meds) - Number(!!a.resident!.data.care.time_critical_meds) || a.resident!.data.room.localeCompare(b.resident!.data.room))
    .map((p) => p.id);
  world.taskSeq += 1;
  const task = {
    id: `t${String(world.taskSeq).padStart(6, "0")}`,
    kind: "med_round" as const,
    label: `${round} medication round`,
    residentId: null,
    need: null,
    createdT: world.t,
    startedT: null,
    staffNeeded: 1 as const,
    femaleOnly: false,
    priority: 0,
    request: false,
    deadlineT: null,
    members: [giver.id],
    assigned: [],
    status: "open" as const,
    bt: newBtState(),
    data: { round, roundT, queue, moved: [], i: 0, phase: 0, start: 0, interruptions: 0, started: 0 },
  };
  world.tasks.set(task.id, task);
  emit(world, "task.created", [giver.id], { taskId: task.id, kind: "med_round", residentId: null, dueT: roundT });
}

function giveDose(c: Ctx, r: Person): void {
  const { world, task } = c;
  const giver = c.staff[0]!;
  const round = String(task.data.round);
  const chance = Math.min(ERROR_CAP, ERROR_PER_INTERRUPTION * Number(task.data.interruptions));
  const log = world.shiftLog.get(r.id)!;
  if (chance > 0 && world.rng.meds.next() < chance) {
    emit(world, "med.missed", [r.id, giver.id], { residentId: r.id, round });
    log.lateOrMissedDoses += 1;
    return;
  }
  const lateMins = Math.floor((world.t - Number(task.data.roundT)) / 60);
  if (lateMins > LATE_AFTER_MINS) {
    emit(world, "med.late", [r.id, giver.id], { residentId: r.id, round, lateMins });
    log.lateOrMissedDoses += 1;
  }
  emit(world, "med.administered", [r.id, giver.id], { residentId: r.id, round, staffId: giver.id, lateMins });
}

/** Bed to bed. Progress lives in task.data, so a paused round resumes where it stopped. */
const giveMeds: BtNode<Ctx> = leaf("give medication bed to bed", (c) => {
  const { world, task } = c;
  const giver = c.staff[0]!;
  const queue = task.data.queue as string[];
  const moved = task.data.moved as string[];
  for (;;) {
    const i = Number(task.data.i);
    if (i >= queue.length) return "success";
    const r = world.people.get(queue[i]!)!;
    const res = r.resident!;
    if (!r.onMap || res.fall) {
      task.data.i = i + 1; // away or on the floor: not given on this round
      task.data.phase = 0;
      continue;
    }
    if (res.busyTaskId && Number(task.data.phase) === 0) {
      if (moved.includes(r.id)) return "running"; // second time round: wait for them
      // Busy with someone else: come back to them at the end of the round.
      queue.push(r.id);
      moved.push(r.id);
      task.data.i = i + 1;
      continue;
    }
    if (Number(task.data.phase) === 0) {
      const spot = besideThem(r)[0]!;
      if (giver.atPoint !== spot) {
        if (giver.move?.destPointId !== spot) walkTo(world, giver, spot);
        return "running";
      }
      task.data.phase = 1;
      task.data.start = world.t;
      markChecked(world, r, [giver], false);
    }
    if (world.t - Number(task.data.start) < (MINUTES_PER_RESIDENT + ppeMins(world, r)) * 60) return "running";
    giveDose(c, r);
    task.data.i = i + 1;
    task.data.phase = 0;
  }
});

export const medRoundTree: BtNode<Ctx> = seq(
  "med_round",
  act("start", (c) => {
    setBadges(c.staff, ["pill"], c.task.label);
    if (c.task.data.started === 1) return;
    c.task.data.started = 1;
    begin(c, ["pill"]);
    emit(c.world, "med_round.started", [c.staff[0]!.id], { round: String(c.task.data.round), staffId: c.staff[0]!.id });
  }),
  giveMeds,
  act("complete", (c) => {
    emit(c.world, "med_round.completed", [c.staff[0]!.id], { round: String(c.task.data.round), staffId: c.staff[0]!.id, interruptions: Number(c.task.data.interruptions) });
  }),
);

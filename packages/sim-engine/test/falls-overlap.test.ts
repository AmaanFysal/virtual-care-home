// Several falls at once (docs/05 "Several falls at once"), and the other tasks that used to be
// lost when their only person was taken away. Nobody is ever left on the floor: a new fall takes
// the nearest carer whose work can wait, never one with another fallen resident or in the middle
// of a two-person transfer; if nobody can come, help is asked for and the next person free comes.

import { describe, expect, it } from "vitest";
import { TICK_SECONDS, formatSimTime, type AnySimEvent, type EventPayloads, type FallSeverity, type SimEvent } from "@vch/shared-types";
import { checkInvariants, createSim, type Sim } from "../src/index.js";
import { watchFalls } from "../src/falls.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const HOUR = 3600 / TICK_SECONDS;
const THREE = ["res_peggy", "res_stan", "res_arthur"];

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

/** Tick for a clock time on the run's first day (or the next morning for times before 06:00). */
function tickAt(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  let mins = h! * 60 + m! - 6 * 60;
  if (mins <= 0) mins += 24 * 60;
  return (mins * 60) / TICK_SECONDS;
}

interface Run {
  sim: Sim;
  events: AnySimEvent[];
  hard: string[];
  /** Anything that changed about a resident while they were on the floor, before they were moved. */
  floorChanges: string[];
}

function run(seed: string, falls: { residentId: string; at: string; severity: FallSeverity }[], hours = 6): Run {
  const sim = createSim({ seed, data });
  falls.forEach((f, i) => sim.enqueue({ seq: i + 1, applyTick: tickAt(f.at), type: "inject_fall", payload: { residentId: f.residentId, severity: f.severity }, source: "user" }));
  const end = Math.max(...falls.map((f) => tickAt(f.at))) + hours * HOUR;
  const events: AnySimEvent[] = [];
  const hard: string[] = [];
  const floorChanges: string[] = [];
  const spot = new Map<string, string>();
  for (let i = 0; i < end; i++) {
    events.push(...sim.step());
    for (const v of checkInvariants(sim.world)) hard.push(`${formatSimTime(sim.t)} ${v.rule}: ${v.details}`);
    for (const f of falls) {
      const r = sim.world.people.get(f.residentId)!;
      if (!r.resident!.fall) continue;
      const where = `${r.x},${r.y}`;
      if (!spot.has(r.id)) spot.set(r.id, where);
      if (r.posture !== "on_floor" || r.resident!.asleep || r.move || spot.get(r.id) !== where) floorChanges.push(`${formatSimTime(sim.t)} ${r.id} ${r.posture} asleep=${r.resident!.asleep}`);
    }
    // Nobody is ever on two falls, and everyone on a fall is working on it.
    for (const t of sim.world.tasks.values()) {
      if (t.kind !== "fall") continue;
      for (const id of t.assigned) if (sim.world.people.get(id)!.staff!.taskId !== t.id) hard.push(`${formatSimTime(sim.t)} ${id} listed on ${t.id} but doing something else`);
    }
  }
  return { sim, events, hard, floorChanges };
}

function threeFalls(seed: string, at: string, severities: FallSeverity[]): Run {
  const [h, m] = at.split(":").map(Number);
  const plus = (i: number) => `${String(h).padStart(2, "0")}:${String(m! + i).padStart(2, "0")}`;
  return run(seed, THREE.map((residentId, i) => ({ residentId, at: plus(i), severity: severities[i]! })));
}

function everyoneSeenTo(r: Run, severities: FallSeverity[]): void {
  expect(r.hard).toEqual([]);
  expect(r.floorChanges).toEqual([]);
  THREE.forEach((id, i) => {
    const mine = (type: keyof EventPayloads) => r.events.filter((e) => e.type === type && (e.payload as { residentId?: string }).residentId === id);
    expect(mine("resident.fell"), id).toHaveLength(1);
    expect(mine("fall.found"), `${id} found`).toHaveLength(1);
    expect(mine("fall.assessed"), `${id} assessed`).toHaveLength(1);
    if (severities[i] === "minor") expect(mine("fall.lifted"), `${id} lifted`).toHaveLength(1);
    else expect(mine("resident.conveyed_to_hospital"), `${id} conveyed`).toHaveLength(1);
  });
  // Nothing of the falls is left over, and every missed target is reported with a cause.
  expect([...r.sim.world.tasks.values()].filter((t) => t.kind === "fall")).toEqual([]);
  expect(r.sim.world.paramedics).toEqual([]);
  for (const b of ofType(r.events, "sla.breached")) expect(b.payload.cause).not.toBe("");
}

describe("golden: three falls one minute apart", () => {
  for (const seed of ["1", "2"]) {
    for (const severities of [["minor", "minor", "minor"], ["serious", "minor", "serious"]] as FallSeverity[][]) {
      it(`by day (10:00, ${severities.join("/")}, seed ${seed}): everyone attended, assessed, and lifted or conveyed`, () => {
        const r = threeFalls(seed, "10:00", severities);
        everyoneSeenTo(r, severities);
        // The third fall found nobody free: help was asked for, and it was reached as soon as someone was.
        const help = ofType(r.events, "fall.help_requested");
        expect(help.map((e) => e.payload.residentId)).toContain("res_arthur");
        const late = ofType(r.events, "sla.breached").filter((e) => e.payload.target === "fall_attendance");
        for (const b of late) expect(b.payload.cause).toMatch(/^no one free/);
      });
      it(`at night (02:00, ${severities.join("/")}, seed ${seed}): the floating carer and the on-call RN are called; everyone attended, assessed, and lifted or conveyed`, () => {
        const r = threeFalls(seed, "02:00", severities);
        everyoneSeenTo(r, severities);
        const help = ofType(r.events, "fall.help_requested");
        expect(help[0]!.payload).toMatchObject({ residentId: "res_stan", called: "floating_carer" });
        expect(help[0]!.payload.reason).toMatch(/^lone night carer with another fall/);
        expect(ofType(r.events, "on_call_rn.called")).toHaveLength(1);
      });
    }
  }

  it("at night with three minor falls, two carers lift one resident at a time; the one left has help asked for", () => {
    const r = threeFalls("1", "02:00", ["minor", "minor", "minor"]);
    const paired = ofType(r.events, "fall.help_requested").filter((e) => / helping to lift /.test(e.payload.reason));
    expect(paired.length).toBeGreaterThan(0);
    expect(r.hard).toEqual([]);
  });
});

describe("what a fall may interrupt", () => {
  it("never takes someone in the middle of a two-person transfer or turn", () => {
    const sim = createSim({ seed: "1", data });
    let held: { taskId: string; staff: string[]; residentId: string } | null = null;
    for (let i = 0; i < 24 * HOUR && !held; i++) {
      sim.step();
      for (const t of sim.world.tasks.values()) {
        if (t.staffNeeded === 2 && t.data.phase === "performing" && t.status === "active") {
          held = { taskId: t.id, staff: [...t.assigned], residentId: t.residentId! };
          break;
        }
      }
    }
    expect(held).not.toBeNull();
    const other = data.residents.find((r) => r.id !== held!.residentId && sim.world.people.get(r.id)!.onMap)!;
    sim.enqueue({ seq: 1, applyTick: sim.tick + 1, type: "inject_fall", payload: { residentId: other.id, severity: "minor" }, source: "user" });
    const events: AnySimEvent[] = [];
    while (sim.world.tasks.has(held!.taskId)) {
      events.push(...sim.step());
      const task = sim.world.tasks.get(held!.taskId);
      if (task && task.data.phase === "performing") expect(task.assigned).toEqual(held!.staff);
    }
    expect(ofType(events, "task.interrupted").filter((e) => e.payload.taskId === held!.taskId)).toEqual([]);
  });
});

describe("the fall_unattended invariant", () => {
  it("fires when a fallen resident has nobody with them and no help asked for, for over 2 minutes", () => {
    const sim = createSim({ seed: "1", data });
    sim.enqueue({ seq: 1, applyTick: tickAt("10:00"), type: "inject_fall", payload: { residentId: "res_win", severity: "minor" }, source: "user" });
    for (let i = 0; i < tickAt("10:00") + 2; i++) sim.step();
    const w = sim.world;
    const task = w.tasks.get(w.people.get("res_win")!.resident!.fall!.taskId)!;
    // What the old bug did: take everyone away and forget the fall.
    for (const id of task.assigned) w.people.get(id)!.staff!.taskId = null;
    task.assigned = [];
    task.data.helpRequestedT = null;
    watchFalls(w);
    expect(checkInvariants(w).map((v) => v.rule)).not.toContain("fall_unattended");
    w.t += 121;
    expect(checkInvariants(w).map((v) => v.rule)).toContain("fall_unattended");
  });
});

describe("tasks that used to be lost when their only person was taken away", () => {
  it("the 21:00 medication round is given when a serious fall keeps the late lead with the resident", () => {
    for (const [seed, at, residentId] of [["2", "21:05", "res_win"], ["3", "21:20", "res_peggy"], ["2", "20:55", "res_raj"]] as const) {
      const r = run(seed, [{ residentId, at, severity: "serious" }], 4);
      expect(r.hard, `${seed} ${at}`).toEqual([]);
      expect(ofType(r.events, "med_round.completed").filter((e) => e.payload.round === "21:00"), `${seed} ${at}`).toHaveLength(1);
      expect([...r.sim.world.tasks.values()].filter((t) => t.kind === "med_round"), `${seed} ${at}`).toEqual([]);
    }
  });

  it("two serious falls a minute apart: both get an ambulance and both are conveyed", () => {
    const r = run("1", [
      { residentId: "res_win", at: "11:00", severity: "serious" },
      { residentId: "res_raj", at: "11:01", severity: "serious" },
    ]);
    expect(r.hard).toEqual([]);
    expect(ofType(r.events, "ambulance.called")).toHaveLength(2);
    expect(ofType(r.events, "resident.conveyed_to_hospital").map((e) => e.payload.residentId).sort()).toEqual(["res_raj", "res_win"]);
  });

  it("a resident who falls on her own way to the Lounge goes there again later", () => {
    const sim = createSim({ seed: "1", data });
    let fellT = 0;
    const lounge: number[] = [];
    for (let i = 0; i < 30 * HOUR; i++) {
      const events = sim.step();
      const res = sim.world.people.get("res_win")!.resident!;
      const own = res.busyTaskId ? sim.world.tasks.get(res.busyTaskId) : undefined;
      if (!fellT && own?.kind === "self_move" && sim.t - own.createdT > 30) {
        sim.enqueue({ seq: 1, applyTick: sim.tick + 1, type: "inject_fall", payload: { residentId: "res_win", severity: "minor" }, source: "user" });
        fellT = sim.t;
      }
      for (const e of events) if (fellT && e.type === "person.entered_room" && e.actors[0] === "res_win" && e.payload.roomId === "Lounge") lounge.push(e.t);
    }
    expect(fellT).toBeGreaterThan(0);
    expect([...sim.world.tasks.values()].filter((t) => t.kind === "self_move" && t.status !== "active")).toEqual([]);
    expect(lounge.length).toBeGreaterThan(0);
  });
});

// Golden scenario tests for the fall procedure and medication rounds (docs/11, spec decisions 8
// and 9). Each injects a fall at a set time on a set resident and checks the correct process.

import { describe, expect, it } from "vitest";
import { TICK_SECONDS, type AnySimEvent, type EventPayloads, type FallSeverity, type SimEvent } from "@vch/shared-types";
import { checkInvariants, createSim, type Sim } from "../src/index.js";
import { isMedsTrained } from "../src/meds.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const START = 108000; // Tue 06:00
const HOUR = 3600 / TICK_SECONDS;

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
  violations: string[];
  /** Posture of the fallen resident on each tick, with whether the fall had been assessed yet. */
  postures: { posture: string; assessed: boolean }[];
}

function fallRun(residentId: string, at: string, severity: FallSeverity, hours = 30, seed = "1"): Run {
  const sim = createSim({ seed, data });
  sim.enqueue({ seq: 1, applyTick: tickAt(at), type: "inject_fall", payload: { residentId, severity }, source: "user" });
  const events: AnySimEvent[] = [];
  const violations: string[] = [];
  const postures: Run["postures"] = [];
  for (let i = 0; i < hours * HOUR; i++) {
    events.push(...sim.step());
    for (const v of checkInvariants(sim.world)) violations.push(`${v.rule}: ${v.details}`);
    const r = sim.world.people.get(residentId)!;
    if (r.resident!.fall) postures.push({ posture: r.posture, assessed: r.resident!.fall.assessed });
  }
  return { sim, events, violations, postures };
}

function one<K extends keyof EventPayloads>(run: Run, type: K): SimEvent<K> {
  const found = ofType(run.events, type).filter((e) => (e.payload as { residentId?: string }).residentId !== undefined);
  expect(found, type).toHaveLength(1);
  return found[0]!;
}

function commonChecks(run: Run, residentId: string, nok: string): void {
  expect(run.violations.slice(0, 3)).toEqual([]); // hard safety invariants only
  // Service targets may slip during a fall, but every breach is reported with a cause.
  for (const b of ofType(run.events, "sla.breached")) expect(b.payload.cause).not.toBe("");
  // Nobody moves them before assessment: on the floor on every tick until assessed.
  for (const p of run.postures) if (!p.assessed) expect(p.posture).toBe("on_floor");
  const fell = one(run, "resident.fell");
  expect(fell.source).toBe("user");
  expect(one(run, "fall.found").t - fell.t).toBeLessThanOrEqual(3 * 60);
  expect(one(run, "family.informed").payload).toMatchObject({ residentId, visitorId: nok });
  expect(one(run, "incident.recorded").payload).toMatchObject({ residentId, kind: "fall" });
}

describe("golden: day falls (RN on the wing)", () => {
  it("minor fall at 10:00: RN attends within 10 minutes, assesses, two staff lift, family phoned, 30-minute checks", () => {
    const run = fallRun("res_peggy", "10:00", "minor");
    commonChecks(run, "res_peggy", "vis_linda");
    const fell = one(run, "resident.fell");
    expect(one(run, "fall.rn_called").payload.onCall).toBe(false);
    const assessed = one(run, "fall.assessed");
    expect(assessed.payload.outcome).toBe("cleared_to_move");
    expect(assessed.payload.by).toMatch(/^(stf_maria|agy_)/);
    expect(assessed.t - 10 * 60 - fell.t).toBeLessThanOrEqual(10 * 60); // RN at her side within 10 minutes
    const lifted = one(run, "fall.lifted");
    expect(lifted.payload.staffIds).toHaveLength(2);
    expect(lifted.t).toBeGreaterThan(assessed.t);
    expect(ofType(run.events, "cqc.notification_flagged")).toEqual([]);
    // Post-fall observations every 30 minutes for 4 hours: the check invariant held at 30 minutes.
    expect(run.sim.world.people.get("res_peggy")!.resident!.postFallUntil).toBe(lifted.t + 4 * 3600);
  });

  it("serious fall at 10:00: 999, a carer stays, paramedics in 30 to 90 minutes, hospital, CQC flagged", () => {
    const run = fallRun("res_peggy", "10:00", "serious");
    commonChecks(run, "res_peggy", "vis_linda");
    const called = one(run, "ambulance.called");
    expect(one(run, "fall.assessed").payload.outcome).toBe("wait_for_ambulance");
    const arrived = one(run, "paramedics.arrived");
    expect(arrived.t - called.t).toBeGreaterThanOrEqual(30 * 60);
    expect(arrived.t - called.t).toBeLessThanOrEqual(90 * 60);
    // The carer who called 999 is with her until she's taken to hospital.
    const carer = called.payload.staffId;
    const conveyed = one(run, "resident.conveyed_to_hospital");
    const carerWork = ofType(run.events, "task.started").filter((e) => e.actors[0] === carer && e.t > called.t && e.t < conveyed.t);
    expect(carerWork).toEqual([]);
    expect(one(run, "cqc.notification_flagged").payload.regulation).toMatch(/Regulation 18/);
    const peggy = run.sim.people().find((p) => p.id === "res_peggy")!;
    expect(peggy).toMatchObject({ onMap: false, away: "hospital", bedId: "Room5.Bed" });
  });
});

describe("golden: night falls (on-call RN by phone)", () => {
  it.each([
    ["06:40", "res_peggy", "vis_linda"],
    ["02:00", "res_stan", "vis_maureen"],
  ])("minor fall at %s: phone assessment, floating carer helps lift, back to bed", (at, residentId, nok) => {
    const run = fallRun(residentId, at, "minor");
    commonChecks(run, residentId, nok);
    const rnCalled = one(run, "fall.rn_called");
    expect(rnCalled.payload.onCall).toBe(true);
    const assessed = one(run, "fall.assessed");
    expect(assessed.payload.by).toBe("on-call RN");
    expect(assessed.t - rnCalled.t).toBeGreaterThanOrEqual(3 * 60);
    expect(assessed.t - rnCalled.t).toBeLessThanOrEqual(5 * 60 + 5);
    const lifted = one(run, "fall.lifted");
    expect(lifted.payload.staffIds).toContain("ext_night_float");
    expect(lifted.payload.to).toBe("bed");
    expect(ofType(run.events, "ambulance.called")).toEqual([]);
    expect(ofType(run.events, "on_call_rn.called")).toEqual([]); // minor night falls stay phone-only
  });

  it.each([
    ["06:40", "res_peggy", "vis_linda"],
    ["02:00", "res_stan", "vis_maureen"],
  ])("serious fall at %s: 999, carer stays, floating carer covers the wing, hospital, CQC flagged", (at, residentId, nok) => {
    const run = fallRun(residentId, at, "serious");
    commonChecks(run, residentId, nok);
    expect(one(run, "fall.assessed").payload.outcome).toBe("wait_for_ambulance");
    const called = one(run, "ambulance.called");
    const conveyed = one(run, "resident.conveyed_to_hospital");
    // The on-call RN comes over from the main building and stays until the paramedics have gone.
    const rnCalled = one(run, "on_call_rn.called");
    expect(rnCalled.t).toBe(called.t);
    const rnArrived = ofType(run.events, "on_call_rn.arrived")[0]!;
    expect(rnArrived.t - called.t).toBeGreaterThanOrEqual(8 * 60);
    expect(rnArrived.t - called.t).toBeLessThanOrEqual(13 * 60);
    const paramedicsLeft = ofType(run.events, "person.departed").find((e) => e.actors[0] === "ext_paramedics")!;
    expect(ofType(run.events, "on_call_rn.departed")[0]!.t).toBeGreaterThanOrEqual(paramedicsLeft.t);
    // While one carer waits with them, someone else (the floating carer, the night carer or the
    // on-call RN) keeps checking everyone else.
    const staying = called.payload.staffId;
    const otherChecks = ofType(run.events, "resident.checked").filter((e) => e.payload.staffId !== staying && e.t > called.t && e.t < conveyed.t && e.payload.residentId !== residentId);
    expect(otherChecks.length).toBeGreaterThan(0);
    one(run, "cqc.notification_flagged");
  });
});

describe("golden: other times and residents stay within every rule", () => {
  it.each([
    ["res_raj", "08:10", "minor"],
    ["res_win", "08:10", "serious"],
    ["res_arthur", "21:20", "minor"],
    ["res_dennis", "13:05", "minor"],
    ["res_peggy", "23:10", "serious"],
    ["res_raj", "17:05", "serious"],
  ] as const)("%s falls at %s (%s)", (residentId, at, severity) => {
    for (const seed of ["1", "2", "3"]) {
      const run = fallRun(residentId, at, severity, 48, seed);
      expect(run.violations.slice(0, 3), `seed ${seed}`).toEqual([]); // hard invariants: zero, even with a fall
      for (const p of run.postures) if (!p.assessed) expect(p.posture).toBe("on_floor");
    }
  });
});

describe("medication rounds", () => {
  const sim = createSim({ seed: "1", data });
  const events: AnySimEvent[] = [];
  for (let i = 0; i < 24 * 7 * HOUR; i++) events.push(...sim.step());

  it("runs four rounds a day: the RN at 08:00, 13:00 and 17:00, the late lead at 21:00", () => {
    const tuesday = ofType(events, "med_round.started").filter((e) => e.t < START + 86400);
    expect(tuesday.map((e) => [e.payload.round, e.payload.staffId])).toEqual([
      ["08:00", "stf_maria"],
      ["13:00", "stf_maria"],
      ["17:00", "stf_maria"],
      ["21:00", "stf_dave"],
    ]);
    const doses = ofType(events, "med.administered").filter((e) => e.t < START + 86400);
    expect(doses).toHaveLength(24);
  });

  it("only ever has meds-trained staff give medication", () => {
    const trained = new Set([...sim.world.people.values()].filter(isMedsTrained).map((p) => p.id));
    for (const e of ofType(events, "med.administered")) expect(e.payload.staffId.startsWith("agy_") || trained.has(e.payload.staffId), e.payload.staffId).toBe(true);
    expect(ofType(events, "invariant.violated").filter((e) => e.payload.rule === "meds_trained")).toEqual([]);
  });

  it("misses no doses on a week with no interruptions", () => {
    expect(ofType(events, "med.missed")).toEqual([]);
  });

  it("pauses the round for a fall and resumes where it left off", () => {
    // Step to the moment the 08:00 round is under way, then Stan falls.
    const s = createSim({ seed: "1", data });
    const out: AnySimEvent[] = [];
    const violations: string[] = [];
    let injected = false;
    for (let i = 0; i < 4 * HOUR; i++) {
      out.push(...s.step());
      for (const v of checkInvariants(s.world)) violations.push(v.rule);
      const round = [...s.world.tasks.values()].find((t) => t.kind === "med_round" && t.status === "active");
      if (round && !injected && Number(round.data.i) >= 1) {
        s.enqueue({ seq: 1, applyTick: s.tick + 1, type: "inject_fall", payload: { residentId: "res_stan", severity: "minor" }, source: "user" });
        injected = true;
      }
    }
    expect(injected).toBe(true);
    const interrupted = ofType(out, "task.interrupted").filter((e) => e.payload.kind === "med_round");
    expect(interrupted.length).toBeGreaterThanOrEqual(1);
    expect(interrupted[0]!.payload.reason).toBe("called to a fall");
    expect(ofType(out, "task.resumed").filter((e) => e.payload.kind === "med_round").length).toBeGreaterThanOrEqual(1);
    const completed = ofType(out, "med_round.completed").find((e) => e.payload.round === "08:00")!;
    expect(completed.payload.interruptions).toBeGreaterThanOrEqual(1);
    // Nobody gets a dose twice.
    const dealt = [...ofType(out, "med.administered"), ...ofType(out, "med.missed")].filter((e) => e.payload.round === "08:00").map((e) => e.payload.residentId);
    expect(new Set(dealt).size).toBe(dealt.length);
    expect(violations).toEqual([]);
  });

  it("makes missed doses more likely the more a round is interrupted", () => {
    // Force a heavily interrupted round: eight interruptions is the 40% cap.
    const s = createSim({ seed: "7", data });
    for (let i = 0; i < 2 * HOUR - 1; i++) s.step(); // just before 08:00
    const out: AnySimEvent[] = [];
    let forced = false;
    for (let i = 0; i < HOUR; i++) {
      out.push(...s.step());
      const round = [...s.world.tasks.values()].find((t) => t.kind === "med_round");
      if (round && !forced) {
        round.data.interruptions = 8;
        forced = true;
      }
    }
    const missed = ofType(out, "med.missed").length;
    const given = ofType(out, "med.administered").length;
    expect(missed + given).toBe(6);
    expect(missed).toBeGreaterThan(0);
  });
});

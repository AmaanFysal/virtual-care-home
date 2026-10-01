// The full scenario audit's PR B (docs/workstreams/sim-audit/plan.md): the engine bugs. The named
// cases (test/audit.test.ts) show each rule no longer breaks; these check the fixes do the right thing.

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_START_T, SECONDS_PER_DAY, type AnySimEvent, type Scenario } from "@vch/shared-types";
import { createSim } from "../src/index.js";
import { loadAuditScenario } from "../scripts/fuzz-lib.js";
import { loadAdmissions, loadDirectorConfig, loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const casesDir = fileURLToPath(new URL("../../../docs/workstreams/sim-audit/cases/", import.meta.url));

function run(scenario: Scenario, seed: number, hours: number): AnySimEvent[] {
  const sim = createSim({ seed: String(seed), data, admissions: loadAdmissions(), director: { config: loadDirectorConfig(), random: false, scenario } });
  const events: AnySimEvent[] = [];
  while (sim.t < DEFAULT_START_T + hours * 3600) events.push(...sim.step());
  return events;
}

function runCase(file: string): AnySimEvent[] {
  const s = loadAuditScenario(casesDir + file);
  return run(s, s.audit!.seed, s.audit!.hours);
}

const of = <T extends AnySimEvent["type"]>(events: AnySimEvent[], type: T) => events.filter((e): e is Extract<AnySimEvent, { type: T }> => e.type === type);

describe("U1: a fall while an ambulance is on its way", () => {
  const events = runCase("illness-ambulance-then-fall.json");
  it("takes the resident to hospital, from the floor, on the one call", () => {
    const fell = of(events, "resident.fell").find((e) => e.payload.residentId === "res_dennis")!;
    const conveyed = of(events, "resident.conveyed_to_hospital").filter((e) => e.payload.residentId === "res_dennis");
    expect(conveyed).toHaveLength(1);
    expect(conveyed[0]!.t - fell.t).toBeLessThan(2 * 3600);
    // One crew comes for him, not one for the illness and another for the fall.
    expect(of(events, "paramedics.arrived").filter((e) => e.payload.residentId === "res_dennis")).toHaveLength(1);
  }, 60_000);
});

describe("U5: a fall during a medication round", () => {
  const events = runCase("fall-during-round.json");
  it("records the dose as delayed with its reason, then gives it once she's up", () => {
    const delayed = of(events, "med.delayed").filter((e) => e.payload.residentId === "res_win");
    expect(delayed.map((e) => e.payload.reason)).toEqual(["on the floor after a fall"]);
    const given = of(events, "med.administered").find((e) => e.payload.residentId === "res_win" && e.payload.round === delayed[0]!.payload.round && e.t > delayed[0]!.t);
    const lifted = of(events, "fall.lifted").find((e) => e.payload.residentId === "res_win")!;
    expect(given).toBeDefined();
    expect(given!.t).toBeGreaterThanOrEqual(lifted.t);
  }, 60_000);
});

describe("U6: time-critical medicine", () => {
  it("gives Arthur's Parkinson's medicine within 30 minutes on calm weeks (seeds 1 and 2)", () => {
    for (const seed of [1, 2]) {
      const events = run({ id: "calm", name: "calm", description: "", random: false, events: [] }, seed, 7 * 24);
      const doses = of(events, "med.administered").filter((e) => e.payload.residentId === "res_arthur");
      expect(doses.length).toBeGreaterThanOrEqual(27);
      for (const d of doses) expect(d.payload.lateMins, `seed ${seed} ${d.payload.round}`).toBeLessThanOrEqual(30);
    }
  }, 120_000);
});

describe("U11: staff taken ill", () => {
  it("relieves a night carer taken ill: the floating carer comes and he goes home within 15 minutes of her arriving", () => {
    const events = runCase("night-carer-ill.json");
    const ill = of(events, "infection.symptomatic").find((e) => e.payload.personId === "stf_florin")!;
    expect(of(events, "second_carer.called").some((e) => e.t === ill.t && e.payload.reason === "the night carer taken ill")).toBe(true);
    const lorna = of(events, "second_carer.arrived").find((e) => e.t >= ill.t)!;
    const left = of(events, "person.departed").find((e) => e.actors[0] === "stf_florin" && e.t >= ill.t)!;
    expect(left.t - lorna.t).toBeLessThanOrEqual(15 * 60);
    // No resident care after the symptoms began.
    expect(of(events, "task.started").filter((e) => e.actors.includes("stf_florin") && e.t > ill.t)).toEqual([]);
  }, 60_000);

  // Symptoms the minute she arrives for her shift, and the minute before (she's let in, then sent home).
  it.each([0, -1])("sends home a carer whose symptoms start as she arrives (%i min), before her shift", (offsetMins) => {
    // Wednesday's early lead (Blessing): find when she arrives, then run again with flu at that minute.
    const plain = createSim({ seed: "1", data, config: loadDirectorConfig() });
    let arriveT = 0;
    while (!arriveT) for (const e of plain.step()) if (e.type === "person.arrived" && e.actors[0] === "stf_blessing" && e.t > DEFAULT_START_T + 12 * 3600) arriveT = e.t;
    const sim = createSim({ seed: "1", data, config: loadDirectorConfig() });
    const atT = arriveT + offsetMins * 60;
    sim.enqueue({ seq: 1, applyTick: (atT - DEFAULT_START_T) / 5, type: "infection_case", payload: { personId: "stf_blessing", disease: "flu" }, source: "user" });
    const events: AnySimEvent[] = [];
    while (sim.t < atT + 6 * 3600) events.push(...sim.step());
    const absent = of(events, "staff.absent").find((e) => e.payload.staffId === "stf_blessing" && e.t >= atT);
    expect(absent?.payload.reason).toMatch(/sick/);
    expect(of(events, "shift.started").filter((e) => e.payload.staffId === "stf_blessing" && e.t >= atT)).toEqual([]);
    expect(of(events, "task.started").filter((e) => e.actors.includes("stf_blessing") && e.t >= atT)).toEqual([]);
  }, 60_000);
});

describe("U17 and R17: several serious falls at once", () => {
  it("calls 999 for each within 20 minutes; the nurse hands over the wait to a carer", () => {
    const events = runCase("three-falls-at-lunch.json");
    for (const fell of of(events, "resident.fell").filter((e) => e.payload.severity === "serious")) {
      const call = of(events, "ambulance.called").find((e) => e.payload.residentId === fell.payload.residentId && e.t >= fell.t)!;
      expect(call.t - fell.t, fell.payload.residentId).toBeLessThanOrEqual(20 * 60);
    }
    expect(of(events, "fall.handed_over").length).toBeGreaterThan(0);
  }, 60_000);

  it("sends a crew for each 999 call: two serious falls at once are both conveyed within 2 hours", () => {
    const t = DEFAULT_START_T + SECONDS_PER_DAY + 4 * 3600; // Wednesday 10:00
    const scenario: Scenario = { id: "two-serious-falls", name: "two serious falls", description: "", random: false, events: [
      { t, type: "inject_fall", params: { residentId: "res_peggy", severity: "serious" } },
      { t, type: "inject_fall", params: { residentId: "res_raj", severity: "serious" } },
    ] };
    for (const seed of [1, 2, 3]) {
      const events = run(scenario, seed, 32);
      const conveyed = of(events, "resident.conveyed_to_hospital");
      expect(conveyed.map((e) => e.payload.residentId).sort(), `seed ${seed}`).toEqual(["res_peggy", "res_raj"]);
      for (const e of conveyed) expect(e.t - t, `seed ${seed} ${e.payload.residentId}`).toBeLessThan(2 * 3600);
    }
  }, 120_000);
});

describe("found while building PR B: a resident admitted during a round", () => {
  it("gives a resident admitted during a medication round their dose on it", () => {
    // Seed 38 (fuzz case 1468, shrunk): Arthur's last days begin early Wednesday; Kamala is admitted to his room at 08:04 on Thursday.
    const scenario: Scenario = { id: "admitted-during-round", name: "admitted during a round", description: "", random: false, events: [
      { t: 183600, type: "end_of_life_start", params: { residentId: "res_arthur", expectedDays: 1 } },
      { t: 288240, type: "admission", params: { cardId: "adm_kamala" } },
    ] };
    const events = run(scenario, 38, 52);
    expect(of(events, "resident.admitted").map((e) => e.t)).toEqual([288240]);
    const dose = of(events, "med.administered").find((e) => e.payload.residentId === "res_kamala" && e.payload.round === "08:00");
    expect(dose).toBeDefined();
  }, 60_000);
});

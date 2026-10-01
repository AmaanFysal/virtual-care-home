// Snapshots (ADR-0008): a sim restored from a snapshot carries on exactly as the run it was taken
// from. Each snapshot goes through v8's serialiser, as the server writes it to disk, and the
// restored run's events must match the uninterrupted run's byte for byte (constitution rule 2).

import { deserialize, serialize } from "node:v8";
import { describe, expect, it } from "vitest";
import { DEFAULT_START_T, TICK_SECONDS, type Scenario, type SimInput } from "@vch/shared-types";
import { createSim, restoreSim, SNAPSHOT_SCHEMA, type Sim, type SimSnapshot } from "../src/index.js";
import { createRng } from "../src/rng.js";
import { loadAdmissions, loadDirectorConfig, loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const HOURS = 30;
const TICKS = (HOURS * 3600) / TICK_SECONDS;
const FALL_T = DEFAULT_START_T + 2 * 3600; // Tue 08:00, in the middle of the morning round
const fallTick = (FALL_T - DEFAULT_START_T) / TICK_SECONDS;
// A manual sick call queued well ahead, so some snapshots hold it unapplied.
const SICK: SimInput = { seq: 1, applyTick: fallTick + 2000, type: "staff_sick", payload: { staffId: "stf_maria", cover: "auto" }, source: "user" };

const scenario: Scenario = {
  id: "snapshot",
  name: "snapshot",
  description: "",
  random: true,
  events: [
    { t: FALL_T, type: "inject_fall", params: { residentId: "res_win", severity: "serious" } },
    { t: FALL_T + 6 * 3600, type: "resident_illness", params: { residentId: "res_stan", kind: "chest_infection", severity: "mild" } },
  ],
};

function fresh(): Sim {
  const sim = createSim({ seed: "7", data, admissions: loadAdmissions(), director: { config: loadDirectorConfig(), random: true, scenario } });
  sim.enqueue(SICK);
  return sim;
}

function runTo(sim: Sim, tick: number, out: string[]): void {
  while (sim.tick < tick) for (const e of sim.step()) out.push(JSON.stringify(e));
}

function roundTrip(sim: Sim): Sim {
  const bytes = serialize(sim.snapshot());
  return restoreSim(deserialize(bytes) as SimSnapshot, data);
}

describe("snapshots", () => {
  const reference: string[] = [];
  const whole = fresh();
  runTo(whole, TICKS, reference);
  const endView = JSON.stringify(whole.describe());

  // Before the fall; seconds into it (first carer on the way); while waiting for the ambulance;
  // with the sick call still queued; after it; and late on.
  const cuts = [600, fallTick + 3, fallTick + 120, fallTick + 1500, fallTick + 2400, TICKS - 700];

  it.each(cuts)("carries on byte-identically from a snapshot at tick %i", (cut) => {
    const before: string[] = [];
    const sim = fresh();
    runTo(sim, cut, before);
    const restored = roundTrip(sim);
    expect(restored.tick).toBe(cut);
    const after: string[] = [];
    runTo(restored, TICKS, after);
    expect([...before, ...after]).toEqual(reference);
    expect(JSON.stringify(restored.describe())).toBe(endView);
  }, 60_000);

  it("survives several restores in a row", () => {
    let sim = fresh();
    const events: string[] = [];
    for (const cut of cuts) {
      runTo(sim, cut, events);
      sim = roundTrip(sim);
    }
    runTo(sim, TICKS, events);
    expect(events).toEqual(reference);
  }, 60_000);

  it("leaves out the weather, keeps the schema, and refuses another schema", () => {
    const snap = fresh().snapshot();
    expect(snap.schema).toBe(SNAPSHOT_SCHEMA);
    expect(snap.world.data.weather).toBeUndefined();
    expect("rng" in snap.world).toBe(false);
    expect(() => restoreSim({ ...snap, schema: 99 as typeof SNAPSHOT_SCHEMA }, data)).toThrow(/schema/);
  });

  it("restores a random stream exactly from its state", () => {
    const a = createRng("s");
    for (let i = 0; i < 10; i++) a.next();
    const b = createRng("s", a.state());
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });
});

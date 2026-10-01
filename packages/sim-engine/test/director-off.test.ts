// The master switch (docs/10): with the director off, a run is exactly what it was before the
// director existed. Each seed's week-long event log is fingerprinted and compared with the
// fingerprints recorded on main (test/fixtures/). The one field left out is `sim.started`'s
// `dataVersion`, a hash of the data files: adding data no rule reads without the director (Nikos,
// the main-building carer, in rota.json) changes that string and nothing else. Re-recorded on main
// (e44f98f) with it blanked, 2026-09-30; re-recorded again for the tuning review (sub-milestone e,
// 2026-09-30), which deliberately changes director-off runs: 9 tuning rules removed, the only
// people free for a pressing turn keep to short work, and a day break or going home counts only
// staff on a shift as floor cover. Re-recorded for the full scenario audit's PR B (2026-10-01),
// which deliberately changes calm days: escorting carers walk at the resident's pace (and follow them
// straight through a doorway, on the resident's route; neither draws more than 1.5 m ahead of the
// other), visitors wait by the bed rather than in the en-suite, Arthur's
// time-critical dose isn't put off for care in progress, and whoever gives the next medication round
// starts no long care in the 15 minutes before it.
//
// The building (v1.0-testbed) describes and never changes what people do (its spec, decision 2). So its
// events (doors and windows) are left out and the rest renumbered: the fingerprints are the ones
// recorded for PR B, unchanged, which is the proof.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TICK_SECONDS } from "@vch/shared-types";
import { createSim } from "../src/index.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const WEEK = (7 * 86400) / TICK_SECONDS;
const expected = JSON.parse(readFileSync(new URL("./fixtures/director-off-hashes.json", import.meta.url), "utf8")) as Record<string, string>;

/** The building's own events (v1.0-testbed), left out of the fingerprint. */
const BUILDING_EVENT = /^(door|window|equipment|heating)\./;

function weekHash(seed: string): string {
  const sim = createSim({ seed, data });
  const hash = createHash("sha256");
  let seq = 0;
  for (let i = 0; i < WEEK; i++)
    for (const e of sim.step()) {
      if (BUILDING_EVENT.test(e.type)) continue;
      seq += 1;
      const renumbered = { ...e, id: `e${seq}`, seq };
      hash.update(JSON.stringify(e.type === "sim.started" ? { ...renumbered, payload: { ...e.payload, dataVersion: "(data)" } } : renumbered));
    }
  return hash.digest("hex");
}

describe("with the director off", () => {
  it.each(["1", "2", "3", "4", "5", "6", "7", "8"])("seed %s runs a week byte-identical to the pre-director engine", (seed) => {
    expect(weekHash(seed)).toBe(expected[seed]);
  }, 60000);
});

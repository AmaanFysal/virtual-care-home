// The master switch (docs/10): with the director off, a run is exactly what it was before the
// director existed. Each seed's week-long event log is fingerprinted and compared with the
// fingerprints recorded on main (test/fixtures/). The one field left out is `sim.started`'s
// `dataVersion`, a hash of the data files: adding data no rule reads without the director (Nikos,
// the main-building carer, in rota.json) changes that string and nothing else. Re-recorded on main
// (e44f98f) with it blanked, 2026-09-30; re-recorded again for the tuning review (sub-milestone e,
// 2026-09-30), which deliberately changes director-off runs: 9 tuning rules removed, the only
// people free for a pressing turn keep to short work, and a day break or going home counts only
// staff on a shift as floor cover.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TICK_SECONDS } from "@vch/shared-types";
import { createSim } from "../src/index.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const WEEK = (7 * 86400) / TICK_SECONDS;
const expected = JSON.parse(readFileSync(new URL("./fixtures/director-off-hashes.json", import.meta.url), "utf8")) as Record<string, string>;

function weekHash(seed: string): string {
  const sim = createSim({ seed, data });
  const hash = createHash("sha256");
  for (let i = 0; i < WEEK; i++) for (const e of sim.step()) hash.update(JSON.stringify(e.type === "sim.started" ? { ...e, payload: { ...e.payload, dataVersion: "(data)" } } : e));
  return hash.digest("hex");
}

describe("with the director off", () => {
  it.each(["1", "2", "3", "4", "5", "6", "7", "8"])("seed %s runs a week byte-identical to the pre-director engine", (seed) => {
    expect(weekHash(seed)).toBe(expected[seed]);
  }, 60000);
});

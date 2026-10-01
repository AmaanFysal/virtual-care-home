// The simulation audit (docs/workstreams/sim-audit/): the safety monitor (src/safety.ts) and the
// fuzz runner's library (scripts/fuzz-lib.ts). Every named case in docs/workstreams/sim-audit/cases/
// is replayed with every safety rule checked on every tick: a known gap ("expect": "fails") must
// still break its rules, so the monitor keeps catching it; a fixed one ("expect": "passes") must
// not break them again. Each fix flips its cases to "passes" (the workstream's plan.md).

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createSim, validateScenario } from "../src/index.js";
import { createSafetyMonitor, SAFETY_RULES } from "../src/safety.js";
import { broke, generateCase, loadAuditScenario, pools, runScenarioFile, toScenario } from "../scripts/fuzz-lib.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const casesDir = fileURLToPath(new URL("../../../docs/workstreams/sim-audit/cases/", import.meta.url));
const hashRun = (watch: boolean): string => {
  const sim = createSim({ seed: "1", data });
  const monitor = createSafetyMonitor();
  const hash = createHash("sha256");
  for (let i = 0; i < 17280; i++) {
    const events = sim.step();
    if (watch) monitor.check(sim.world, events);
    hash.update(JSON.stringify(events));
  }
  return hash.digest("hex");
};

describe("the safety monitor", () => {
  it("only watches: a day with it on is byte-identical to a day without", () => {
    expect(hashRun(true)).toBe(hashRun(false));
  }, 60_000);
});

describe("the fuzz runner's cases", () => {
  it("are the same every time they're generated, and every one is a valid scenario", () => {
    const pl = pools(data);
    for (let i = 0; i < 300; i++) {
      const c = generateCase(i, pl);
      expect(generateCase(i, pl)).toEqual(c);
      expect(validateScenario(toScenario(c), data), c.id).toEqual([]);
    }
  });
});

describe("the audit's named cases", () => {
  const files = readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort();

  it("each names its gaps, known rules, and whether it still fails", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const s = loadAuditScenario(casesDir + f);
      expect(validateScenario(s, data), f).toEqual([]);
      expect(s.audit?.gaps?.length, f).toBeGreaterThan(0);
      for (const rule of s.audit?.rules ?? []) expect(Object.keys(SAFETY_RULES), `${f}: ${rule}`).toContain(rule.split("@")[0]);
      expect(["fails", "passes"], f).toContain(s.audit?.expect);
    }
  });

  for (const f of files) {
    const s = loadAuditScenario(casesDir + f);
    const { gaps = [], rules = [], expect: state } = s.audit ?? {};
    it(`${gaps.join(", ")} ${f}: ${state === "fails" ? "still breaks" : "no longer breaks"} ${rules.join(", ")}`, () => {
      const r = runScenarioFile(s, data);
      expect(r.crash).toBeNull();
      for (const rule of rules) expect(broke(r, rule), rule).toBe(state === "fails");
    }, 120_000);
  }
});

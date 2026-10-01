// The simulation audit (docs/workstreams/sim-audit/): the safety monitor (src/safety.ts) and the
// fuzz runner's library (scripts/fuzz-lib.ts). Every named case in docs/workstreams/sim-audit/cases/
// is replayed with every safety rule checked on every tick: the rules of a gap still open (`rules`)
// must still break, so the monitor keeps catching it; the rules of a fixed one (`fixed`) mustn't
// break again. Each fix moves its rules from `rules` to `fixed` (the workstream's plan.md).

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

  it("each names its gaps, its rules (open and fixed), and whether it still fails", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const s = loadAuditScenario(casesDir + f);
      expect(validateScenario(s, data), f).toEqual([]);
      expect(s.audit?.gaps?.length, f).toBeGreaterThan(0);
      for (const rule of [...(s.audit?.rules ?? []), ...(s.audit?.fixed ?? [])]) expect(Object.keys(SAFETY_RULES), `${f}: ${rule}`).toContain(rule.split("@")[0]);
      expect(s.audit?.expect, f).toBe((s.audit?.rules ?? []).length > 0 ? "fails" : "passes");
    }
  });

  for (const f of files) {
    const s = loadAuditScenario(casesDir + f);
    const { gaps = [], rules = [], fixed = [] } = s.audit ?? {};
    const says = [rules.length ? `still breaks ${rules.join(", ")}` : "", fixed.length ? `no longer breaks ${fixed.join(", ")}` : ""].filter(Boolean).join("; ");
    it(`${gaps.join(", ")} ${f}: ${says}`, () => {
      const r = runScenarioFile(s, data);
      expect(r.crash).toBeNull();
      for (const rule of rules) expect(broke(r, rule), `${rule} should still break`).toBe(true);
      for (const rule of fixed) expect(broke(r, rule), `${rule} is fixed`).toBe(false);
    }, 120_000);
  }
});

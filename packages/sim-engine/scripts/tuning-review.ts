// The tuning review (docs/12, docs/10 sub-milestone e): each tuning rule switched off on its own,
// measured against the calm-week baseline (seeds 1-8, a week each, director off). A rule is kept
// only if removing it pushes service breaches over 2 in a week on any seed. Two more measurements
// are reported, not used to decide: calm weeks with Kamala in Raj's room (a new resident's rota
// clash, docs/12), and three falls a minute apart at four times of day, two of them in the break
// windows (rules that only act during falls can't show on a calm week).
//   pnpm --filter @vch/sim-engine tuning-review [--rule <name>|baseline] [--json]

import { parseArgs } from "node:util";
import { TICK_SECONDS, type AnySimEvent } from "@vch/shared-types";
import { checkInvariants, createSim } from "../src/index.js";
import { TUNING_RULES, type Tuning, type TuningRule } from "../src/tuning.js";
import { loadAdmissions, loadDirectorConfig, loadWorldData } from "../tools/load-data.js";

const { values } = parseArgs({ options: { rule: { type: "string" }, off: { type: "string" }, json: { type: "boolean", default: false }, seeds: { type: "string", default: "1-8" } } });
const data = loadWorldData();
const config = loadDirectorConfig();
const admissions = loadAdmissions();
const HOUR = 3600 / TICK_SECONDS;
const [from, to] = values.seeds!.split("-").map(Number);
const seeds = Array.from({ length: to! - from! + 1 }, (_, i) => String(from! + i));

interface Result {
  rule: string;
  calm: number[];
  calmHard: number;
  kamala: number[];
  kamalaHard: number;
  falls: number;
  fallsHard: number;
}

/** Runs `hours` and returns service breaches and hard violations (checked every tick). */
function run(seed: string, hours: number, tuning: Partial<Tuning>, setup?: (sim: ReturnType<typeof createSim>) => void): { breaches: number; hard: number } {
  const sim = createSim({ seed, data, config, admissions, tuning });
  setup?.(sim);
  let breaches = 0;
  let hard = 0;
  const failing = new Set<string>();
  for (let i = 0; i < hours * HOUR; i++) {
    for (const e of sim.step() as AnySimEvent[]) if (e.type === "sla.breached") breaches += 1;
    const now = new Set(checkInvariants(sim.world).map((v) => `${v.rule}:${v.key ?? ""}`));
    for (const k of now) if (!failing.has(k)) hard += 1;
    failing.clear();
    for (const k of now) failing.add(k);
  }
  return { breaches, hard };
}

/** Kamala in Raj's room from the start (as when she moves in after his death). */
function withKamala(sim: ReturnType<typeof createSim>): void {
  const raj = sim.world.people.get("res_raj")!;
  Object.assign(raj, { onMap: false, roomId: null, atPoint: null, move: null });
  raj.resident!.away = "died";
  for (const t of [...sim.world.tasks.values()]) if (t.residentId === "res_raj") sim.world.tasks.delete(t.id);
  sim.enqueue({ seq: 1, applyTick: 2, type: "admission", payload: { cardId: "adm_kamala" }, source: "user" });
}

/** Three minor falls a minute apart at `clock` on the first day (or the next morning before 06:00). */
function threeFalls(clock: string, who: string[]) {
  const [h, m] = clock.split(":").map(Number);
  let mins = h! * 60 + m! - 6 * 60;
  if (mins <= 0) mins += 24 * 60;
  return (sim: ReturnType<typeof createSim>) =>
    who.forEach((residentId, i) => sim.enqueue({ seq: i + 1, applyTick: ((mins + i) * 60) / TICK_SECONDS, type: "inject_fall", payload: { residentId, severity: "minor" }, source: "user" }));
}

function measure(rule: string, offs: string[] = [rule]): Result {
  const tuning: Partial<Tuning> = rule === "baseline" ? {} : Object.fromEntries(offs.map((r) => [r, false]));
  const calm = seeds.map((s) => run(s, 168, tuning));
  const kamala = seeds.map((s) => run(s, 168, tuning, withKamala));
  // Three minor falls a minute apart: in the morning, during the early and late breaks (a day break
  // can be called back), and at night.
  const sets: [string, string[]][] = [
    ["10:00", ["res_peggy", "res_stan", "res_win"]],
    ["11:00", ["res_arthur", "res_stan", "res_win"]],
    ["18:15", ["res_peggy", "res_stan", "res_arthur"]],
    ["02:00", ["res_peggy", "res_stan", "res_arthur"]],
  ];
  const falls = seeds.slice(0, 4).flatMap((s) => sets.map(([at, who]) => run(s, 30, tuning, threeFalls(at, who))));
  return {
    rule,
    calm: calm.map((r) => r.breaches),
    calmHard: calm.reduce((s, r) => s + r.hard, 0),
    kamala: kamala.map((r) => r.breaches),
    kamalaHard: kamala.reduce((s, r) => s + r.hard, 0),
    falls: falls.reduce((s, r) => s + r.breaches, 0),
    fallsHard: falls.reduce((s, r) => s + r.hard, 0),
  };
}

// --off a,b,c: all of these off together (the combined removal).
if (values.off) {
  const offs = values.off.split(",");
  for (const r of offs) if (!(r in TUNING_RULES)) throw new Error(`unknown tuning rule "${r}"`);
  const r = measure("combined", offs);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  console.log(`combined (${offs.length} off)`.padEnd(26), `calm ${sum(r.calm)} (max ${Math.max(...r.calm)}/week, hard ${r.calmHard}; by seed ${r.calm.join(" ")})  with Kamala ${sum(r.kamala)} (max ${Math.max(...r.kamala)}, hard ${r.kamalaHard})  falls ${r.falls} (hard ${r.fallsHard})`);
  process.exit(0);
}
const rules = values.rule ? [values.rule] : ["baseline", ...Object.keys(TUNING_RULES)];
for (const rule of rules) {
  if (rule !== "baseline" && !(rule in TUNING_RULES)) throw new Error(`unknown tuning rule "${rule}"`);
  const r = measure(rule);
  if (values.json) console.log(JSON.stringify(r));
  else {
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const verdict = rule === "baseline" ? "" : Math.max(...r.calm) > 2 || r.calmHard > 0 ? "KEEP" : "remove";
    console.log(
      `${rule.padEnd(26)} calm ${String(sum(r.calm)).padStart(3)} (max ${Math.max(...r.calm)}/week, hard ${r.calmHard})  with Kamala ${String(sum(r.kamala)).padStart(3)} (max ${Math.max(...r.kamala)}, hard ${r.kamalaHard})  falls ${String(r.falls).padStart(3)} (hard ${r.fallsHard})  ${verdict}  ${rule === "baseline" ? "" : TUNING_RULES[rule as TuningRule]}`,
    );
  }
}

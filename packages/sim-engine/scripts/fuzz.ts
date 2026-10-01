// Fuzz runner (the simulation audit, 2026-09-30). Generates random combinations of director
// events (several at once, back to back, at awkward times such as handovers, medication rounds and
// meals, during outbreaks and short staffing) across many seeds, runs each with every invariant
// checked every tick (the engine's `checkInvariants` and the safety monitor, src/safety.ts), and
// saves any case that breaks a rule its seed's calm baseline doesn't as a scenario file that
// reproduces it (shrunk to the fewest events that still break it):
//   pnpm --filter @vch/sim-engine sim --seed <s> --hours <h> --scenario <file> [--report]
//
//   pnpm --filter @vch/sim-engine fuzz --cases 2000 --workers 12 [--first 0] [--out <dir>]
//   pnpm --filter @vch/sim-engine fuzz --baseline --seeds 1-8 --days 7     (rules broken with no events)
//   pnpm --filter @vch/sim-engine fuzz --replay <case.json>                (re-run a saved case, print violations)
//   pnpm --filter @vch/sim-engine fuzz --dump <i>                          (case i as a scenario file, on stdout)
//
// Case i is generated from its own seeded stream, so `--first i --cases 1` regenerates it exactly.

import { fork, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatSimTime, type WorldData } from "@vch/shared-types";
import { validateScenario } from "../src/index.js";
import { SAFETY_RULES, type SafetyViolation } from "../src/safety.js";
import { loadWorldData } from "../tools/load-data.js";
import { generateCase, loadAuditScenario, minimise, pools, runCase, runScenarioFile, signatures, toScenario, type CaseResult, type FuzzCase, type Pools } from "./fuzz-lib.js";

// ------------------------------------------------------------------ worker and master

type Job = { kind: "case"; index: number } | { kind: "baseline"; seed: number; days: number; random: boolean } | { kind: "minimise"; index: number; sig: string };

function runJob(job: Job, data: WorldData, pl: Pools): unknown {
  if (job.kind === "case") return runCase(generateCase(job.index, pl), data);
  if (job.kind === "baseline") return runCase({ id: `baseline-${job.random ? "random" : "calm"}-${job.seed}`, theme: "baseline", seed: job.seed, days: job.days, random: job.random, events: [] }, data);
  const m = minimise(generateCase(job.index, pl), job.sig, data);
  return { index: job.index, sig: job.sig, ...m };
}

const { values } = parseArgs({
  options: {
    cases: { type: "string", default: "200" },
    first: { type: "string", default: "0" },
    workers: { type: "string", default: "8" },
    out: { type: "string" },
    baseline: { type: "boolean", default: false },
    seeds: { type: "string", default: "1-8" },
    days: { type: "string", default: "7" },
    replay: { type: "string" },
    worker: { type: "boolean", default: false },
    "per-rule": { type: "string", default: "2" },
    raw: { type: "string" },
    dump: { type: "string" },
  },
});

const here = fileURLToPath(import.meta.url);
const repoRoot = resolve(here, "../../../..");

if (values.worker) {
  const data = loadWorldData();
  const pl = pools(data);
  process.on("message", (job: Job) => process.send!({ job, result: runJob(job, data, pl) }));
} else if (values.dump) {
  const c = generateCase(Number(values.dump), pools(loadWorldData()));
  console.log(JSON.stringify(toScenario(c, { audit: { seed: c.seed, hours: c.days * 24, theme: c.theme } }), null, 2));
} else if (values.replay) {
  const s = loadAuditScenario(values.replay);
  const seed = s.audit?.seed ?? 1;
  const hours = s.audit?.hours ?? 72;
  const r = runScenarioFile(s, loadWorldData());
  console.log(`${s.id}: seed ${seed}, ${hours} h, ${r.events} events, ${r.breaches} service breaches, ${r.ms} ms${r.crash ? `\nCRASH ${r.crash}` : ""}`);
  for (const v of r.violations) console.log(`  ${formatSimTime(v.t, true)}  [${v.severity}] ${v.rule}: ${v.details}`);
  for (const k of r.skipped) console.log(`  skipped ${k.type}: ${k.reason}`);
} else {
  await master();
}

async function master(): Promise<void> {
  const data = loadWorldData();
  const pl = pools(data);
  const stamp = values.baseline ? "baseline" : `cases-${values.first}-${Number(values.first) + Number(values.cases) - 1}`;
  const outDir = resolve(values.out ?? `${repoRoot}/docs/workstreams/sim-audit/fuzz`, stamp);
  mkdirSync(`${outDir}/cases`, { recursive: true });
  const rawDir = values.raw ? resolve(values.raw, stamp) : outDir;
  mkdirSync(rawDir, { recursive: true });
  const seedRange = (spec: string) => {
    const [a, b] = spec.split("-").map(Number);
    return Array.from({ length: (b ?? a)! - a! + 1 }, (_, i) => a! + i);
  };

  // Every case is checked before it runs (the same validator as the CLI and the server).
  const cases: FuzzCase[] = values.baseline ? [] : Array.from({ length: Number(values.cases) }, (_, i) => generateCase(Number(values.first) + i, pl));
  for (const c of cases) {
    const errors = validateScenario(toScenario(c), data);
    if (errors.length) throw new Error(`${c.id} doesn't validate: ${errors.join("; ")}`);
  }
  const seeds = values.baseline ? seedRange(values.seeds!) : [...new Set(cases.map((c) => c.seed))].sort((a, b) => a - b);
  const longest = values.baseline ? Number(values.days) : Math.max(...cases.map((c) => c.days));
  const jobs: Job[] = [];
  for (const seed of seeds) {
    jobs.push({ kind: "baseline", seed, days: longest, random: false });
    if (values.baseline || cases.some((c) => c.seed === seed && c.random)) jobs.push({ kind: "baseline", seed, days: longest, random: true });
  }
  for (const c of cases) jobs.push({ kind: "case", index: c.index });

  const results = await pool(jobs, Number(values.workers), (job, result) => {
    appendFileSync(`${rawDir}/results.jsonl`, JSON.stringify({ job, result }) + "\n");
  });

  const baseline = new Map<string, Set<string>>();
  for (const { job, result } of results) {
    if (job.kind !== "baseline") continue;
    baseline.set(`${job.seed}:${job.random}`, signatures(result as CaseResult));
  }
  // Baseline summary: rules broken with no events at all.
  const lines: string[] = [];
  const baseRules = new Map<string, { runs: Set<string>; examples: string[] }>();
  for (const { job, result } of results) {
    if (job.kind !== "baseline") continue;
    const r = result as CaseResult;
    for (const v of r.violations) {
      const b = baseRules.get(v.rule) ?? { runs: new Set<string>(), examples: [] };
      b.runs.add(r.id);
      if (b.examples.length < 4) b.examples.push(`${r.id} ${formatSimTime(v.t, true)} ${v.details}`);
      baseRules.set(v.rule, b);
    }
  }
  lines.push(`# Fuzz run ${stamp}`, "", `Baselines: seeds ${seeds.join(", ")}, ${longest} days each (calm${values.baseline ? " and random director" : ""}).`, "");
  lines.push("## Rules broken in the baselines (no scripted events)", "");
  for (const [rule, b] of [...baseRules].sort()) lines.push(`- **${rule}** (${SAFETY_RULES[rule as keyof typeof SAFETY_RULES]?.severity}): ${b.runs.size} baseline runs (${[...b.runs].sort().join(", ")})`, ...b.examples.map((e) => `  - ${e}`));
  if (values.baseline) {
    writeFileSync(`${outDir}/summary.md`, lines.join("\n") + "\n");
    console.log(lines.join("\n"));
    return;
  }

  // New failures: signatures a case breaks that its seed's baseline doesn't.
  const byRule = new Map<string, { cases: FuzzCase[]; sigs: Map<string, number> }>();
  let crashes = 0;
  let totalMs = 0;
  for (const { job, result } of results) {
    if (job.kind !== "case") continue;
    const r = result as CaseResult;
    totalMs += r.ms;
    const c = cases.find((x) => x.index === job.index)!;
    const base = baseline.get(`${c.seed}:${c.random}`) ?? new Set();
    if (r.crash) crashes += 1;
    for (const sig of signatures(r)) {
      if (base.has(sig)) continue;
      const rule = sig.split(":")[0]!;
      const e = byRule.get(rule) ?? { cases: [] as FuzzCase[], sigs: new Map<string, number>() };
      if (!e.cases.includes(c)) e.cases.push(c);
      e.sigs.set(sig, (e.sigs.get(sig) ?? 0) + 1);
      byRule.set(rule, e);
    }
  }
  // Shrink a couple of examples per rule into scenario files.
  const perRule = Number(values["per-rule"]);
  const shrinkJobs: Job[] = [];
  for (const [rule, e] of byRule) {
    const picked = new Set<string>();
    for (const c of e.cases) {
      if (picked.size >= perRule) break;
      const r = results.find((x) => x.job.kind === "case" && x.job.index === c.index)!.result as CaseResult;
      const sig = [...signatures(r)].find((s) => s.startsWith(`${rule}:`) && !picked.has(s) && !(baseline.get(`${c.seed}:${c.random}`) ?? new Set()).has(s));
      if (!sig) continue;
      picked.add(sig);
      shrinkJobs.push({ kind: "minimise", index: c.index, sig });
    }
  }
  const shrunk = await pool(shrinkJobs, Number(values.workers), () => {});
  const saved = new Map<string, string[]>();
  for (const { result } of shrunk) {
    const m = result as { index: number; sig: string; c: FuzzCase | null; v: SafetyViolation | null; crash: string | null };
    if (!m.c) continue;
    const rule = m.sig.split(":")[0]!;
    const hours = Math.round(m.c.days * 24);
    const file = `${outDir}/cases/${rule}-${m.c.id}.json`;
    // Commands run from packages/sim-engine (pnpm --filter), so paths are relative to it.
    const rel = relative(`${repoRoot}/packages/sim-engine`, file);
    const audit = {
      seed: m.c.seed,
      hours,
      rule,
      severity: SAFETY_RULES[rule as keyof typeof SAFETY_RULES]?.severity ?? "integrity",
      firstAt: m.v ? formatSimTime(m.v.t, true) : null,
      details: m.v?.details ?? m.crash,
      command: `pnpm --filter @vch/sim-engine sim --seed ${m.c.seed} --hours ${hours} --scenario ${rel} --report`,
      replay: `pnpm --filter @vch/sim-engine fuzz --replay ${rel}`,
    };
    writeFileSync(file, JSON.stringify(toScenario({ ...m.c, days: hours / 24 }, { audit }), null, 2) + "\n");
    saved.set(rule, [...(saved.get(rule) ?? []), `${rel} (${m.c.events.length} events, ${hours} h): ${audit.details}`]);
  }

  lines.push("", `## New failures in ${cases.length} cases (not in the seed's baseline)`, "", `Engine crashes: ${crashes}. Mean case time ${Math.round(totalMs / Math.max(1, cases.length))} ms.`, "");
  const themes = new Map<string, number>();
  for (const c of cases) themes.set(c.theme, (themes.get(c.theme) ?? 0) + 1);
  lines.push(`Themes: ${[...themes].map(([k, n]) => `${k} ${n}`).join(", ")}.`, "");
  for (const [rule, e] of [...byRule].sort((a, b) => b[1].cases.length - a[1].cases.length)) {
    const sev = SAFETY_RULES[rule as keyof typeof SAFETY_RULES]?.severity ?? "integrity";
    const byTheme = new Map<string, number>();
    for (const c of e.cases) byTheme.set(c.theme, (byTheme.get(c.theme) ?? 0) + 1);
    lines.push(`### ${rule} (${sev}): ${e.cases.length} cases`, "");
    lines.push(`- themes: ${[...byTheme].map(([k, n]) => `${k} ${n}`).join(", ")}`);
    lines.push(`- who: ${[...e.sigs].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s.split(":")[1] || "-"} ${n}`).join(", ")}`);
    for (const s of saved.get(rule) ?? []) lines.push(`- case: ${s}`);
    lines.push("");
  }
  writeFileSync(`${outDir}/summary.md`, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

/**
 * Runs jobs on child processes. A job that takes over 20 minutes gets its worker replaced and is
 * tried once more (a laptop asleep stops the clock, not the timer); a second time it's a hang.
 */
async function pool(jobs: Job[], size: number, onResult: (job: Job, result: unknown) => void): Promise<{ job: Job; result: unknown }[]> {
  const results: { job: Job; result: unknown }[] = [];
  let next = 0;
  let done = 0;
  const startedAt = Date.now();
  const HANG_MS = 20 * 60 * 1000;
  const retried = new Set<Job>();
  const again: Job[] = [];
  return await new Promise((resolveAll) => {
    if (jobs.length === 0) return resolveAll(results);
    const spawn = () => {
      const child: ChildProcess = fork(here, ["--worker"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
      let current: Job | null = null;
      let timer: NodeJS.Timeout | null = null;
      const give = () => {
        if (again.length === 0 && next >= jobs.length) {
          child.kill();
          return;
        }
        current = again.length > 0 ? again.shift()! : jobs[next++]!;
        timer = setTimeout(() => {
          const job = current!;
          child.kill();
          if (!retried.has(job)) {
            retried.add(job);
            again.push(job);
            spawn();
            return;
          }
          const result = job.kind === "minimise" ? { index: job.index, sig: job.sig, c: null, v: null, crash: "hang" } : { id: String(job.kind === "case" ? job.index : job.kind), crash: "hang: over 20 minutes", violations: [], counts: {}, breaches: 0, skipped: [], ms: HANG_MS };
          record(job, result);
          spawn();
        }, HANG_MS);
        child.send(current);
      };
      const record = (job: Job, result: unknown) => {
        results.push({ job, result });
        onResult(job, result);
        done += 1;
        if (done % 25 === 0 || done === jobs.length) process.stderr.write(`  ${done}/${jobs.length} jobs, ${Math.round((Date.now() - startedAt) / 1000)} s\n`);
        if (done === jobs.length) resolveAll(results);
      };
      child.on("message", (msg: { job: Job; result: unknown }) => {
        if (timer) clearTimeout(timer);
        record(msg.job, msg.result);
        give();
      });
      give();
    };
    for (let i = 0; i < Math.min(size, jobs.length); i++) spawn();
  });
}

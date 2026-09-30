// Headless run: prints the event log to the terminal.
//   pnpm --filter @vch/sim-engine sim --seed 1 --hours 24 [--type shift] [--fall res_peggy@06:40[:serious]] [--positions] [--report]
// --report prints help requests per day by need, the longest wait per resident and call-outs.
// --audit prints a behaviour audit per resident, staff shift and day (thresholds in scripts/audit.config.ts);
//   add --seeds 1-8 to audit several seeds and print only the combined flag summary.
// --director random|scenario|both|off and --scenario <id or path> turn on the scenario director (docs/10);
//   --report then adds a per-day report, and --report --seeds 1-8 prints it for several seeds with totals.

import { parseArgs } from "node:util";
import { DEFAULT_START_T, clockToSeconds, dayIndex, formatSimTime, spriteClashes, type AnySimEvent, type DirectorSettings } from "@vch/shared-types";
import { createSim, toView, validateScenario, type World } from "../src/index.js";
import { loadAdmissions, loadDirectorConfig, loadScenario, loadSprites, loadWorldData } from "../tools/load-data.js";
import { runAudit, summarise, type Flag } from "./audit.js";
import { dayLines, dayReport, emptyTotals, totalsLines } from "./day-report.js";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    hours: { type: "string", default: "4" },
    type: { type: "string" },
    fall: { type: "string" },
    positions: { type: "boolean", default: false },
    report: { type: "boolean", default: false },
    audit: { type: "boolean", default: false },
    seeds: { type: "string" },
    director: { type: "string" },
    scenario: { type: "string" },
    "tuning-off": { type: "string" },
  },
});
/** --tuning-off a,b: tuning rules switched off for this run (docs/12, the tuning review). */
const tuning = Object.fromEntries((values["tuning-off"] ?? "").split(",").filter(Boolean).map((r) => [r, false]));

function directorSettings(): DirectorSettings | undefined {
  const mode = values.director ?? (values.scenario ? "scenario" : "off");
  if (mode === "off") return undefined;
  if (!["random", "scenario", "both"].includes(mode)) throw new Error("--director must be random, scenario, both or off");
  const scenario = values.scenario ? loadScenario(values.scenario) : undefined;
  if (mode !== "random" && !scenario) throw new Error(`--director ${mode} needs --scenario`);
  if (scenario) {
    const errors = validateScenario(scenario, loadWorldData());
    if (errors.length) throw new Error(`Invalid scenario:\n${errors.join("\n")}`);
  }
  return { config: loadDirectorConfig(), random: mode === "random" || mode === "both" || !!scenario?.random, ...(mode !== "random" ? { scenario } : {}) };
}
const director = directorSettings();
/** Remembers names while people exist (agency workers are forgotten after they go home). */
function noteNames(world: World, e: AnySimEvent, names: Map<string, string>): void {
  for (const id of [...e.actors, ...(e.type === "rota.cover_booked" ? [e.payload.staffId] : [])]) if (!names.has(id)) names.set(id, world.people.get(id)?.name ?? id);
}
/** Minutes two people on screen were drawn with the same sheet, by seed and who (docs/08). */
const spriteClashMins = new Map<string, number>();
const spriteManifest = loadSprites();
function noteSpriteClashes(world: World, seed: string): void {
  const onScreen = world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap).map(toView);
  for (const c of spriteClashes(spriteManifest, onScreen)) {
    const key = `seed ${seed}: ${c.ids.map((id) => world.people.get(id)!.name).join(" and ")} (${c.sheet})`;
    spriteClashMins.set(key, (spriteClashMins.get(key) ?? 0) + 1);
  }
}
const seedRange = (spec: string) => {
  const [from, to] = spec.split("-").map(Number);
  return Array.from({ length: (to ?? from)! - from! + 1 }, (_, i) => String(from! + i));
};

if (values.report && values.seeds) {
  // Per-day report for several seeds, then totals across them.
  const totals = emptyTotals();
  const ticks = Math.round((Number(values.hours) * 3600) / 5);
  for (const seed of seedRange(values.seeds)) {
    const sim = createSim({ seed, data: loadWorldData(), admissions: loadAdmissions(), tuning, ...(director ? { director } : {}) });
    const events: AnySimEvent[] = [];
    const names = new Map<string, string>();
    for (let i = 0; i < ticks; i++) {
      for (const e of sim.step()) events.push(e), noteNames(sim.world, e, names);
      if (sim.world.t % 60 === 0) noteSpriteClashes(sim.world, seed);
    }
    console.log(`\n=== seed ${seed} ===`);
    for (const line of dayLines(dayReport(events, names, totals).rows)) console.log(line);
    console.error(`seed ${seed} done`);
  }
  console.log(`\n=== totals, seeds ${values.seeds}, ${values.hours} h each ===`);
  for (const line of totalsLines(totals, (seedRange(values.seeds).length * Number(values.hours)) / 168)) console.log(line);
  const clashes = [...spriteClashMins].map(([k, v]) => `${k} ${v} min`);
  console.log(`  people on screen drawn with the same sheet: ${clashes.length ? clashes.join("; ") : "none"}`);
  process.exit(0);
}

if (values.audit) {
  if (values.fall) throw new Error("--audit runs without injected falls");
  if (values.seeds) {
    const [from, to] = values.seeds.split("-").map(Number);
    const all: (Flag & { seed: number })[] = [];
    for (let s = from!; s <= (to ?? from)!; s++) {
      const { flags } = runAudit(String(s), Number(values.hours), loadWorldData(), undefined, director, tuning);
      all.push(...flags.map((f) => ({ ...f, seed: s })));
      console.error(`seed ${s}: ${flags.length} flags`);
    }
    console.log(`Flags across seeds ${values.seeds}, ${values.hours} h each (by type, most frequent first; who: count):`);
    for (const line of summarise(all)) console.log(line);
    const types = new Map<string, number[]>();
    for (const f of all) types.set(f.type, [...(types.get(f.type) ?? []), f.seed]);
    console.log("\nPer seed:");
    for (const [type, seeds] of [...types].sort((a, b) => b[1].length - a[1].length)) {
      const per = Array.from({ length: (to ?? from)! - from! + 1 }, (_, i) => seeds.filter((x) => x === from! + i).length);
      console.log(`  ${type.padEnd(40)} ${per.map((n) => String(n).padStart(4)).join("")}`);
    }
  } else {
    for (const line of runAudit(values.seed!, Number(values.hours), loadWorldData(), undefined, director, tuning).lines) console.log(line);
  }
  process.exit(0);
}

const sim = createSim({ seed: values.seed!, data: loadWorldData(), admissions: loadAdmissions(), tuning, ...(director ? { director } : {}) });
if (values.fall) {
  // --fall res_peggy@06:40 or res_stan@02:00:serious (the first such time after the start)
  const [residentId, when] = values.fall.split("@");
  const [hh, mm, sev] = when!.split(":");
  const target = dayIndex(DEFAULT_START_T) * 86400 + clockToSeconds(`${hh}:${mm}`);
  const applyT = target > DEFAULT_START_T ? target : target + 86400;
  const severity = sev === "serious" ? "serious" : "minor";
  sim.enqueue({ seq: 1, applyTick: (applyT - DEFAULT_START_T) / 5, type: "inject_fall", payload: { residentId: residentId!, severity }, source: "user" });
}

const describe = (e: AnySimEvent): string => {
  const p = e.payload as Record<string, unknown>;
  const detail = Object.entries(p)
    .filter(([k]) => k !== "staffId")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  return `${formatSimTime(e.t, true)}  ${e.source.padEnd(6)} ${e.type.padEnd(22)} ${e.actors.join(",").padEnd(14)} ${detail}`;
};

const ticks = Math.round((Number(values.hours) * 3600) / 5);
const names = new Map<string, string>();
let count = 0;
const all: AnySimEvent[] = [];
for (let i = 0; i < ticks; i++) {
  for (const e of sim.step()) {
    count++;
    noteNames(sim.world, e, names);
    if (values.report) all.push(e);
    else if (!values.type || e.type.startsWith(values.type)) console.log(describe(e));
  }
}
if (values.report) report(all, sim.t);
if (values.report && director) {
  console.log("\nPer day (director):");
  const { rows, totals } = dayReport(all, names);
  for (const line of dayLines(rows)) console.log(line);
  console.log("\nTotals:");
  for (const line of totalsLines(totals, Number(values.hours) / 168)) console.log(line);
}

function report(events: AnySimEvent[], endT: number): void {
  const requests = events.filter((e) => e.type === "resident.requested_help") as Extract<AnySimEvent, { type: "resident.requested_help" }>[];
  const waits = new Map<string, number>();
  for (const e of events) if (e.type === "task.completed") waits.set(e.payload.taskId, e.payload.waitMins);
  const needs = ["toileting", "thirst", "hunger", "social", "fatigue"] as const;
  const byDay = new Map<string, Record<string, number>>();
  for (const r of requests) {
    const day = formatSimTime(r.t - 6 * 3600).slice(0, 10); // care days run 06:00 to 06:00
    const row = byDay.get(day) ?? Object.fromEntries(needs.map((n) => [n, 0]));
    row[r.payload.need] = (row[r.payload.need] ?? 0) + 1;
    byDay.set(day, row);
  }
  console.log("Help requests per care day (06:00 to 06:00):");
  console.log(`  ${"day".padEnd(11)} ${"total".padStart(5)} ${needs.map((n) => n.padStart(10)).join("")}`);
  for (const [day, row] of byDay) {
    const total = needs.reduce((s, n) => s + row[n]!, 0);
    console.log(`  ${day.padEnd(11)} ${String(total).padStart(5)} ${needs.map((n) => String(row[n]).padStart(10)).join("")}`);
  }
  const days = byDay.size || 1;
  console.log(`  average ${(requests.length / days).toFixed(1)} a day; ${needs.map((n) => `${n} ${((100 * requests.filter((r) => r.payload.need === n).length) / Math.max(1, requests.length)).toFixed(0)}%`).join(", ")}`);
  console.log("\nLongest wait per resident (request to help starting):");
  const worst = new Map<string, { mins: number; at: number; need: string }>();
  for (const r of requests) {
    const mins = waits.get(r.payload.taskId) ?? Math.round((endT - r.t) / 60);
    const cur = worst.get(r.payload.residentId);
    if (!cur || mins > cur.mins) worst.set(r.payload.residentId, { mins, at: r.t, need: r.payload.need });
  }
  for (const [id, w] of [...worst].sort()) console.log(`  ${id.padEnd(12)} ${String(w.mins).padStart(3)} min  (${w.need}, ${formatSimTime(w.at)})`);
  // Floating carer's time on site per night (21:30 to 07:00 = 570 minutes).
  const NIGHT_MINS = 570;
  const onSite = new Map<string, { mins: number; visits: number }>();
  let arrivedAt: number | null = null;
  for (const e of events) {
    if (e.type === "second_carer.arrived") arrivedAt = e.t;
    if (e.type === "second_carer.departed" && arrivedAt !== null) {
      const night = formatSimTime(arrivedAt - 12 * 3600).slice(0, 10); // nights are named by their evening
      const row = onSite.get(night) ?? { mins: 0, visits: 0 };
      row.mins += (e.t - arrivedAt) / 60;
      row.visits += 1;
      onSite.set(night, row);
      arrivedAt = null;
    }
  }
  console.log("\nFloating night carer on site per night (of 570 minutes, 21:30 to 07:00):");
  for (const [night, row] of onSite) {
    const pct = (100 * row.mins) / NIGHT_MINS;
    console.log(`  ${night.padEnd(11)} ${String(Math.round(row.mins)).padStart(4)} min  ${pct.toFixed(0).padStart(3)}%  ${row.visits} visits${pct > 50 ? "  <-- OVER 50%" : ""}`);
  }
  if (arrivedAt !== null) console.log(`  (still on site at the end of the run, since ${formatSimTime(arrivedAt)})`);
  const callouts = events.filter((e) => e.type === "second_carer.called").length;
  const visits = events.filter((e) => e.type === "second_carer.arrived").length;
  console.log(`\nFloating night carer: ${visits} visits, ${callouts} out-of-round call-outs.`);

  // Visitors: visits per day and how many were on site at the busiest moment of mid-afternoon.
  console.log("\nVisitors per care day (visits started; peak on site 14:30 to 16:30; bells out of hours):");
  const visitorOnSite = new Map<string, number>();
  const visitDays = new Map<string, { visits: number; peak: number; bells: number }>();
  const dayOf = (t: number) => formatSimTime(t - 6 * 3600).slice(0, 10);
  let lastT = 0;
  for (const e of events) {
    const row = visitDays.get(dayOf(e.t)) ?? { visits: 0, peak: 0, bells: 0 };
    // Count whoever is already here when the window opens.
    const opens = Math.floor(e.t / 86400) * 86400 + 14.5 * 3600;
    if (lastT < opens && e.t >= opens) row.peak = Math.max(row.peak, [...visitorOnSite.values()].reduce((a, b) => a + b, 0));
    lastT = e.t;
    if (e.type === "visit.started") row.visits += 1;
    if (e.type === "visitor.rang_bell") row.bells += 1;
    if (e.actors[0]?.startsWith("vis_") && (e.type === "person.arrived" || e.type === "person.departed")) {
      visitorOnSite.set(e.actors[0], e.type === "person.arrived" ? 1 : 0);
      const tod = (e.t % 86400) / 3600;
      const count = [...visitorOnSite.values()].reduce((a, b) => a + b, 0);
      if (tod >= 14.5 && tod <= 16.5) row.peak = Math.max(row.peak, count);
    }
    visitDays.set(dayOf(e.t), row);
  }
  for (const [day, row] of visitDays) if (row.visits || row.bells) console.log(`  ${day.padEnd(11)} ${String(row.visits).padStart(3)} visits   peak ${row.peak}   ${row.bells} bells`);

  const hard = events.filter((e) => e.type === "invariant.violated") as Extract<AnySimEvent, { type: "invariant.violated" }>[];
  console.log(`\nHard safety invariants: ${hard.length} violation${hard.length === 1 ? "" : "s"}${hard.length ? " <-- MUST BE ZERO" : ""}`);
  for (const v of hard) console.log(`  ${formatSimTime(v.t)}  ${v.payload.rule}: ${v.payload.details}`);
  const breaches = events.filter((e) => e.type === "sla.breached") as Extract<AnySimEvent, { type: "sla.breached" }>[];
  console.log(`Service targets: ${breaches.length} breach${breaches.length === 1 ? "" : "es"}`);
  const byCause = new Map<string, number>();
  for (const b of breaches) byCause.set(`${b.payload.target}, ${b.payload.cause}`, (byCause.get(`${b.payload.target}, ${b.payload.cause}`) ?? 0) + 1);
  for (const [k, n] of byCause) console.log(`  ${String(n).padStart(3)}  ${k}`);
  for (const b of breaches) console.log(`       ${formatSimTime(b.t)}  ${b.payload.details}  [${b.payload.cause}]`);
}
if (values.positions) {
  console.log(`\nAt ${formatSimTime(sim.t)}:`);
  for (const p of sim.people().filter((p) => p.onMap)) console.log(`  ${p.id.padEnd(14)} ${p.posture.padEnd(8)} ${(p.roomId ?? "-").padEnd(12)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
}
console.log(`\n${count} events, ${ticks} ticks, ends ${formatSimTime(sim.t)}`);

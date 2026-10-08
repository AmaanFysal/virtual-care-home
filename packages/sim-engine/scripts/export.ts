// The activity export (docs/workstreams/activity-export/spec.md): runs the sim and writes its
// activity data as CSV files, one folder per seed, for external models.
//   pnpm --filter @vch/sim-engine export --seed 1 --start 2026-12-01 --days 31 --director random [--every 1m] [--out runs/export] [--no-gzip]
//   pnpm --filter @vch/sim-engine export --seeds 1-4 --start 2027-07-01 --days 31 --director random
// --hours instead of --days for a shorter run; --deaths off as on the public demo; --scenario <id> as for `sim`.

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { DEFAULT_START_T, simTimeAt, type DirectorSettings } from "@vch/shared-types";
import { STREAMS, createSim, dataVersion, exportRun, isoTime, manifestJson, roomsJson, validateScenario, type StreamName } from "../src/index.js";
import { loadAdmissions, loadDirectorConfig, loadScenario, loadWorldData } from "../tools/load-data.js";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    seeds: { type: "string" },
    start: { type: "string" },
    days: { type: "string" },
    hours: { type: "string" },
    every: { type: "string", default: "1m" },
    director: { type: "string", default: "off" },
    scenario: { type: "string" },
    deaths: { type: "string", default: "on" },
    out: { type: "string" },
    "no-gzip": { type: "boolean", default: false },
  },
});

function seconds(spec: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(spec);
  if (!m) throw new Error(`--every "${spec}": use a number and s, m or h, e.g. 5s, 1m, 5m`);
  const s = Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2] as "s" | "m" | "h"];
  if (s <= 0 || s % 5 !== 0) throw new Error(`--every "${spec}": the interval must be a whole number of 5 s ticks`);
  return s;
}

function directorSettings(): DirectorSettings | undefined {
  const mode = values.director!;
  if (mode === "off") return undefined;
  if (!["random", "scenario", "both"].includes(mode)) throw new Error("--director must be off, random, scenario or both");
  const scenario = values.scenario ? loadScenario(values.scenario) : undefined;
  if (mode !== "random" && !scenario) throw new Error(`--director ${mode} needs --scenario`);
  if (scenario) {
    const errors = validateScenario(scenario, loadWorldData());
    if (errors.length) throw new Error(`Invalid scenario:\n${errors.join("\n")}`);
  }
  return { config: loadDirectorConfig(), random: mode !== "scenario" || !!scenario?.random, deaths, ...(scenario ? { scenario } : {}) };
}

const seedRange = (spec: string) => {
  const [from, to] = spec.split("-").map(Number);
  return Array.from({ length: (to ?? from)! - from! + 1 }, (_, i) => String(from! + i));
};

if (values.days && values.hours) throw new Error("Give --days or --hours, not both");
if (!["on", "off"].includes(values.deaths!)) throw new Error("--deaths must be on or off");
const deaths = values.deaths === "on";
const everySeconds = seconds(values.every!);
const startT = values.start ? simTimeAt(values.start) : DEFAULT_START_T;
const start = values.start ?? isoTime(DEFAULT_START_T).slice(0, 10);
const runSeconds = values.hours ? Number(values.hours) * 3600 : Number(values.days ?? "1") * 86400;
if (!(runSeconds > 0) || runSeconds % 5 !== 0) throw new Error("--days or --hours must give a whole number of 5 s ticks");
const length = values.hours ? `${values.hours}h` : `${values.days ?? "1"}d`;
const gzip = !values["no-gzip"];
const director = directorSettings();
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const outRoot = resolve(values.out ? resolve(process.env.INIT_CWD ?? process.cwd(), values.out) : join(repoRoot, "runs/export"));
/** The run's options in full (defaults spelled out, the output folder left out), so a manifest says how to make it again. */
const commandFor = (seed: string) =>
  [`export --seed ${seed} --start ${start}`, values.hours ? `--hours ${values.hours}` : `--days ${values.days ?? "1"}`, `--every ${values.every}`, `--director ${values.director}`, values.scenario ? `--scenario ${values.scenario}` : "", `--deaths ${values.deaths}`, gzip ? "" : "--no-gzip"]
    .filter(Boolean)
    .join(" ");

/** Lines are gathered per stream and flushed in chunks; gzip chunks are concatenated gzip members (one valid .gz file). */
const CHUNK_BYTES = 4 * 1024 * 1024;

for (const seed of values.seeds ? seedRange(values.seeds) : [values.seed!]) {
  const dir = join(outRoot, `seed-${seed}-${start}-${length}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fileOf = (stream: StreamName) => join(dir, `${stream}.csv${gzip ? ".gz" : ""}`);
  const buffers = new Map<StreamName, { lines: string[]; bytes: number }>();
  const flush = (stream: StreamName) => {
    const b = buffers.get(stream);
    if (!b || !b.lines.length) return;
    const text = b.lines.join("\n") + "\n";
    appendFileSync(fileOf(stream), gzip ? gzipSync(text) : text);
    buffers.set(stream, { lines: [], bytes: 0 });
  };
  const write = (stream: StreamName, line: string) => {
    const b = buffers.get(stream) ?? { lines: [], bytes: 0 };
    b.lines.push(line);
    b.bytes += line.length + 1;
    buffers.set(stream, b);
    if (b.bytes >= CHUNK_BYTES) flush(stream);
  };

  const data = loadWorldData();
  const sim = createSim({ seed, data, config: loadDirectorConfig(), admissions: loadAdmissions(), deaths, startT, ...(director ? { director } : {}) });
  const endT = startT + runSeconds;
  const begun = Date.now();
  const rows = exportRun(sim, { endT, everySeconds }, write);
  for (const stream of Object.keys(STREAMS) as StreamName[]) flush(stream);

  writeFileSync(join(dir, "rooms.json"), JSON.stringify(roomsJson(sim.world), null, 2) + "\n");
  const files = Object.fromEntries((Object.keys(STREAMS) as StreamName[]).map((s) => [`${s}.csv${gzip ? ".gz" : ""}`, { rows: rows[s], columns: STREAMS[s] }]));
  const weather = data.weather ? { place: data.weather.place, source: data.weather.source, licence: data.weather.licence, from: data.weather.from, to: data.weather.to } : null;
  const manifest = manifestJson({
    seed,
    start,
    startT,
    endT,
    everySeconds,
    gzip,
    director: { mode: values.director!, scenario: values.scenario ?? null, deaths },
    dataVersion: dataVersion(data),
    weather,
    files,
    command: commandFor(seed),
  });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.error(`seed ${seed}: ${dir} (${((Date.now() - begun) / 1000).toFixed(1)} s; ${Object.entries(rows).map(([k, n]) => `${k} ${n}`).join(", ")})`);
}

// Server entry: loads data, starts one sim, logs to SQLite and serves the WebSocket (docs/08).
//   PORT (default 8787), SEED (default "1"), RUNS_DIR (default <repo>/runs)
//   DIRECTOR=off|random|scenario|both (default off), SCENARIO=<id in data/scenarios or a path>,
//   DEATHS=off for the public demo (docs/10; deaths arrive in sub-milestone c)
//   START=YYYY-MM-DD starts the run at 06:00 on that date (default Tue 3 Nov 2026), for its season's weather

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { DEFAULT_START_T, simTimeAt, type DirectorSettings, type DirectorView } from "@vch/shared-types";
import { createSim, dataVersion, hashString, validateData, validateScenario } from "@vch/sim-engine";
import { loadAdmissions, loadDirectorConfig, loadScenario, loadWorldData } from "@vch/sim-engine/load-data";
import { EventLog } from "./eventlog.js";
import { Runner, parseCommand } from "./runner.js";

const port = Number(process.env.PORT ?? 8787);
const seed = process.env.SEED ?? "1";
const runsDir = process.env.RUNS_DIR ?? fileURLToPath(new URL("../../../runs/", import.meta.url));
// START=2027-05-04 starts the run at 06:00 on that date, so the weather is that season's (v1.0-testbed).
const startT = process.env.START ? simTimeAt(process.env.START) : DEFAULT_START_T;

const data = loadWorldData();
const errors = validateData(data);
if (errors.length > 0) {
  console.error(`Data is invalid:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}

const mode = (process.env.DIRECTOR ?? (process.env.SCENARIO ? "scenario" : "off")) as DirectorView["mode"];
if (!["off", "random", "scenario", "both"].includes(mode)) {
  console.error("DIRECTOR must be off, random, scenario or both");
  process.exit(1);
}
const scenario = process.env.SCENARIO ? loadScenario(process.env.SCENARIO) : undefined;
if ((mode === "scenario" || mode === "both") && !scenario) {
  console.error(`DIRECTOR=${mode} needs SCENARIO`);
  process.exit(1);
}
if (scenario) {
  const problems = validateScenario(scenario, data);
  if (problems.length > 0) {
    console.error(`Scenario is invalid:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
}
const deaths = process.env.DEATHS !== "off";
const config = loadDirectorConfig();
const director: DirectorSettings | undefined =
  mode === "off" ? undefined : { config, random: mode !== "scenario" || !!scenario?.random, deaths, ...(mode !== "random" && scenario ? { scenario } : {}) };
const admissions = loadAdmissions();
const directorView: DirectorView = {
  mode,
  scenario: director?.scenario ? { id: scenario!.id, name: scenario!.name, description: scenario!.description } : null,
  deaths,
  admissions: admissions.filter((c) => c.status === "reviewed").map((c) => ({ id: c.id, name: `${c.resident.name.known_as} ${c.resident.name.last}` })),
};

const created = new Date();
const runId = `run-${created.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-seed${seed}`;
mkdirSync(runsDir, { recursive: true });
const log = new EventLog(`${runsDir}/${runId}.sqlite`, {
  runId,
  seed,
  startT,
  dataVersion: dataVersion(data),
  createdWallclock: created.toISOString(),
  director: director
    ? JSON.stringify({ mode, random: director.random, scenario: director.scenario?.id ?? null, scenarioHash: director.scenario ? hashString(JSON.stringify(director.scenario)) : null, configHash: hashString(JSON.stringify(config)), deaths })
    : "off",
});
// The tuning is passed even with the director off, for manual triggers (a sick call, an infection).
const sim = createSim({ seed, data, config, admissions, deaths, startT, ...(director ? { director } : {}) });
const runner = new Runner(sim, data, log, directorView);

const app = Fastify({ logger: { level: "warn" } });
await app.register(websocket);

app.get("/api/health", async () => ({ ok: true, runId, tick: sim.tick }));

app.get("/ws", { websocket: true }, (socket) => {
  const disconnect = runner.connect({ send: (message) => socket.send(JSON.stringify(message)) });
  socket.on("message", (raw: Buffer) => {
    const command = parseCommand(raw.toString());
    if (!command) {
      socket.send(JSON.stringify({ type: "error", message: "Unrecognised command" }));
      return;
    }
    const reply = runner.handle(command);
    if (reply) socket.send(JSON.stringify(reply));
  });
  socket.on("close", disconnect);
});

runner.start();
await app.listen({ port, host: "127.0.0.1" });
console.log(`Virtual care home server on http://127.0.0.1:${port}  (run ${runId}, director ${mode}${scenario && mode !== "random" ? ` with ${scenario.id}` : ""}, paused; press play in the browser)`);

const shutdown = async () => {
  runner.stop();
  await app.close();
  log.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

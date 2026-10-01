// Server entry: loads data, starts (or resumes) one sim, logs to SQLite and serves the WebSocket
// (docs/08). Settings come from the environment (config.ts, docs/13):
//   PORT (default 8787), HOST, SEED (default "1"), RUNS_DIR (default <repo>/runs)
//   DIRECTOR=off|random|scenario|both (default off), SCENARIO=<id in data/scenarios or a path>,
//   DEATHS=off for the public demo (no deaths or end-of-life decline)
//   START=YYYY-MM-DD starts a new run at 06:00 on that date (default Tue 3 Nov 2026), for its season's weather
//   VCH_MODE=production (only on the host): viewers read-only, ADMIN_TOKEN unlocks controls,
//   ALLOWED_ORIGINS, SPEED, snapshots and resume, bounded storage, connection limits.

import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { DEFAULT_START_T, SECONDS_PER_DAY, simTimeAt, type AnySimEvent, type DirectorSettings, type DirectorView, type ServerMessage } from "@vch/shared-types";
import { createSim, dataVersion, hashString, restoreSim, validateData, validateScenario, type Sim } from "@vch/sim-engine";
import { loadAdmissions, loadDirectorConfig, loadScenario, loadWorldData } from "@vch/sim-engine/load-data";
import { loadConfig, type ServerConfig } from "./config.js";
import { EventLog } from "./eventlog.js";
import { AuthLockout, ConnectionLimiter, MessageBucket, originAllowed } from "./limits.js";
import { engineBuild, latestSnapshot, pruneRuns, resumeDecision, runDir, writeSnapshot, type Identity } from "./persist.js";
import { Runner, parseCommand, type Client } from "./runner.js";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let config: ServerConfig;
try {
  config = loadConfig();
} catch (err) {
  fail((err as Error).message);
}

const seed = process.env.SEED ?? "1";
const runsDir = process.env.RUNS_DIR ?? fileURLToPath(new URL("../../../runs/", import.meta.url));

const data = loadWorldData();
const errors = validateData(data);
if (errors.length > 0) fail(`Data is invalid:\n  ${errors.join("\n  ")}`);

const mode = (process.env.DIRECTOR ?? (process.env.SCENARIO ? "scenario" : "off")) as DirectorView["mode"];
if (!["off", "random", "scenario", "both"].includes(mode)) fail("DIRECTOR must be off, random, scenario or both");
const scenario = process.env.SCENARIO ? loadScenario(process.env.SCENARIO) : undefined;
if ((mode === "scenario" || mode === "both") && !scenario) fail(`DIRECTOR=${mode} needs SCENARIO`);
if (scenario) {
  const problems = validateScenario(scenario, data);
  if (problems.length > 0) fail(`Scenario is invalid:\n  ${problems.join("\n  ")}`);
}
const deaths = process.env.DEATHS !== "off";
const directorConfig = loadDirectorConfig();
const director: DirectorSettings | undefined =
  mode === "off" ? undefined : { config: directorConfig, random: mode !== "scenario" || !!scenario?.random, deaths, ...(mode !== "random" && scenario ? { scenario } : {}) };
const admissions = loadAdmissions();
const directorView: DirectorView = {
  mode,
  scenario: director?.scenario ? { id: scenario!.id, name: scenario!.name, description: scenario!.description } : null,
  deaths,
  admissions: admissions.filter((c) => c.status === "reviewed").map((c) => ({ id: c.id, name: `${c.resident.name.known_as} ${c.resident.name.last}` })),
};
// The director settings needed to replay the run (docs/10), as recorded in its log.
const directorRecord = director
  ? JSON.stringify({ mode, random: director.random, scenario: director.scenario?.id ?? null, scenarioHash: director.scenario ? hashString(JSON.stringify(director.scenario)) : null, configHash: hashString(JSON.stringify(directorConfig)), deaths })
  : "off";
const identity: Identity = { engineBuild: engineBuild(), dataVersion: dataVersion(data), director: directorRecord, seed };

mkdirSync(runsDir, { recursive: true });

// Resume the latest snapshot (the public server only), or start a new run.
let sim: Sim | null = null;
let runId = "";
let log: EventLog | null = null;
let recent: AnySimEvent[] = [];
let inputSeq = 0;
let startT = process.env.START ? simTimeAt(process.env.START) : DEFAULT_START_T;
if (config.production) {
  const latest = latestSnapshot(runsDir);
  for (const s of latest?.skipped ?? []) console.warn(`Skipped an unreadable snapshot: ${s}`);
  if (latest) {
    const decision = resumeDecision(latest.state.header, identity);
    if (decision.resume) {
      const { header } = latest.state;
      sim = restoreSim(latest.state.sim, data);
      runId = latest.runId;
      startT = header.startT;
      log = new EventLog(join(runDir(runsDir, runId), "events.sqlite"), { runId, seed, startT, dataVersion: header.dataVersion, createdWallclock: header.savedWallclock, director: header.director }, { resume: true });
      const cut = log.truncateAfter(header.tick, latest.state.inputSeq);
      recent = log.tail(300);
      inputSeq = latest.state.inputSeq;
      console.log(`Resumed ${runId} at tick ${header.tick} (${latest.file}); log cut back by ${cut.events} events, ${cut.inputs} inputs, ${cut.commands} commands`);
    } else {
      startT = decision.startT;
      console.log(`Starting a fresh run (${decision.reason}), on the day after the last snapshot's date`);
    }
  }
}
if (!sim) {
  const created = new Date();
  runId = `run-${created.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-seed${seed}`;
  mkdirSync(runDir(runsDir, runId), { recursive: true });
  log = new EventLog(join(runDir(runsDir, runId), "events.sqlite"), { runId, seed, startT, dataVersion: identity.dataVersion, createdWallclock: created.toISOString(), director: directorRecord });
  // The tuning is passed even with the director off, for manual triggers (a sick call, an infection).
  sim = createSim({ seed, data, config: directorConfig, admissions, deaths, startT, ...(director ? { director } : {}) });
}
const runLog = log!;
const runSim = sim;
const runner = new Runner(runSim, data, runLog, directorView, { paused: !config.production, speed: config.speed, recent, inputSeq });

// Snapshots and bounded storage (the public server).
const timers: NodeJS.Timeout[] = [];
const saveNow = () => {
  const file = writeSnapshot(runDir(runsDir, runId), {
    header: {
      format: 1,
      runId,
      tick: runSim.tick,
      t: runSim.t,
      seed,
      startT,
      engineBuild: identity.engineBuild,
      dataVersion: identity.dataVersion,
      director: directorRecord,
      node: process.version,
      savedWallclock: new Date().toISOString(),
    },
    ...runner.save(),
  });
  return file;
};
if (config.production) {
  for (const removed of pruneRuns(runsDir, config.keepRuns, runId)) console.log(`Removed old run ${removed}`);
  saveNow(); // a starting point straight away, so a crash in the first minutes still resumes
  timers.push(setInterval(() => {
    try {
      saveNow();
    } catch (err) {
      console.error(`Snapshot failed: ${(err as Error).message}`);
    }
  }, config.snapshotEveryMin * 60_000));
  let prunedAt = runSim.t;
  timers.push(setInterval(() => {
    if (runSim.t - prunedAt < SECONDS_PER_DAY) return;
    prunedAt = runSim.t;
    const removed = runLog.prune(runSim.t - config.eventRetentionDays * SECONDS_PER_DAY);
    if (removed > 0) console.log(`Pruned ${removed} events older than ${config.eventRetentionDays} sim days`);
  }, 60_000));
}

// The WebSocket, with the limits for a public server (limits.ts).
const app = Fastify({ logger: { level: "warn" } });
await app.register(websocket, { options: { maxPayload: 4096, perMessageDeflate: true } });
const limiter = new ConnectionLimiter(config.maxViewers);
const lockout = new AuthLockout();

const clientIp = (request: FastifyRequest): string => {
  const header = config.clientIpHeader ? request.headers[config.clientIpHeader] : undefined;
  return (Array.isArray(header) ? header[0] : header) || request.ip;
};
const digest = (s: string) => createHash("sha256").update(s).digest();
const tokenMatches = (token: string): boolean => !!config.adminToken && timingSafeEqual(digest(token), digest(config.adminToken));

app.get("/api/health", async () => ({ ok: true, runId, tick: runSim.tick, viewers: runner.viewers }));

app.get(
  "/ws",
  {
    websocket: true,
    // Before the upgrade: a page on another site can't open the stream.
    onRequest: async (request, reply) => {
      if (!originAllowed(request.headers.origin, config.allowedOrigins)) await reply.code(403).send({ error: "origin not allowed" });
    },
  },
  (socket, request) => {
    const ip = clientIp(request);
    const refused = limiter.admit(ip, Date.now());
    if (refused) {
      socket.close(1013, refused);
      return;
    }
    const bucket = new MessageBucket();
    const send = (message: ServerMessage) => socket.send(JSON.stringify(message));
    const client: Client = {
      role: config.production ? "viewer" : "admin",
      send,
      buffered: () => socket.bufferedAmount,
      close: (reason) => socket.close(1008, reason),
    };
    const disconnect = runner.connect(client);
    socket.on("message", (raw: Buffer) => {
      if (!bucket.allow(Date.now())) {
        send({ type: "error", message: "Too many messages; slow down" });
        return;
      }
      const command = parseCommand(raw.toString());
      if (!command) {
        send({ type: "error", message: "Unrecognised command" });
        return;
      }
      if (command.type === "auth") {
        // Locally (no token set) everyone is already an admin.
        if (!config.production) return send({ type: "auth", ok: true, role: "admin" });
        if (lockout.locked(ip, Date.now())) return send({ type: "auth", ok: false, role: client.role!, message: "Too many wrong tokens; try again in 15 minutes" });
        if (!tokenMatches(command.token)) {
          lockout.fail(ip, Date.now());
          return send({ type: "auth", ok: false, role: client.role!, message: "Wrong token" });
        }
        lockout.succeed(ip);
        client.role = "admin";
        return send({ type: "auth", ok: true, role: "admin" });
      }
      const reply = runner.handle(command, client.role);
      if (reply) send(reply);
    });
    socket.on("close", () => {
      disconnect();
      limiter.release(ip);
    });
  },
);

runner.start();
await app.listen({ port: config.port, host: config.host });
console.log(
  config.production
    ? `Virtual care home (production) on ${config.host}:${config.port}: run ${runId}, ${config.speed}x, director ${mode}, deaths ${deaths ? "on" : "off"}, origins ${config.allowedOrigins.join(" ")}`
    : `Virtual care home server on http://${config.host}:${config.port}  (run ${runId}, director ${mode}${scenario && mode !== "random" ? ` with ${scenario.id}` : ""}, paused; press play in the browser)`,
);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  runner.stop();
  for (const t of timers) clearInterval(t);
  if (config.production) {
    try {
      console.log(`Saved ${saveNow()} on shutdown`);
    } catch (err) {
      console.error(`Snapshot on shutdown failed: ${(err as Error).message}`);
    }
  }
  await app.close();
  runLog.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

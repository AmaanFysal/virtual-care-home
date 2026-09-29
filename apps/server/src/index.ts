// Server entry: loads data, starts one sim, logs to SQLite and serves the WebSocket (docs/08).
//   PORT (default 8787), SEED (default "1"), RUNS_DIR (default <repo>/runs)

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { DEFAULT_START_T } from "@vch/shared-types";
import { createSim, dataVersion, validateData } from "@vch/sim-engine";
import { loadWorldData } from "@vch/sim-engine/load-data";
import { EventLog } from "./eventlog.js";
import { Runner, parseCommand } from "./runner.js";

const port = Number(process.env.PORT ?? 8787);
const seed = process.env.SEED ?? "1";
const runsDir = process.env.RUNS_DIR ?? fileURLToPath(new URL("../../../runs/", import.meta.url));

const data = loadWorldData();
const errors = validateData(data);
if (errors.length > 0) {
  console.error(`Data is invalid:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}

const created = new Date();
const runId = `run-${created.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-seed${seed}`;
mkdirSync(runsDir, { recursive: true });
const log = new EventLog(`${runsDir}/${runId}.sqlite`, {
  runId,
  seed,
  startT: DEFAULT_START_T,
  dataVersion: dataVersion(data),
  createdWallclock: created.toISOString(),
});
const sim = createSim({ seed, data });
const runner = new Runner(sim, data, log);

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
console.log(`Virtual care home server on http://127.0.0.1:${port}  (run ${runId}, paused; press play in the browser)`);

const shutdown = async () => {
  runner.stop();
  await app.close();
  log.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Snapshots on disk, resuming after a restart, and the bounded event log (ADR-0008, docs/13).

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerMessage } from "@vch/shared-types";
import { createSim, restoreSim, type Sim } from "@vch/sim-engine";
import { loadWorldData } from "@vch/sim-engine/load-data";
import { EventLog } from "../src/eventlog.js";
import { KEEP_SNAPSHOTS, engineBuild, latestSnapshot, nextMorning, pruneRuns, resumeDecision, runDir, writeSnapshot, type SavedState, type SnapshotHeader } from "../src/persist.js";
import { Runner } from "../src/runner.js";

const data = loadWorldData();
const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "vch-persist-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const meta = { runId: "run-1", seed: "1", startT: 108000, dataVersion: "d", createdWallclock: "now" };
const header = (sim: Sim, extra: Partial<SnapshotHeader> = {}): SnapshotHeader => ({
  format: 1,
  runId: "run-20261001-120000-seed1",
  tick: sim.tick,
  t: sim.t,
  seed: "1",
  startT: 108000,
  engineBuild: "e",
  dataVersion: "d",
  director: "off",
  node: process.version,
  savedWallclock: "now",
  ...extra,
});
const rows = (db: DatabaseSync) => db.prepare("SELECT seq, tick, t, type, actors, payload, source FROM events ORDER BY seq").all();
const dbOf = (log: EventLog) => (log as unknown as { db: DatabaseSync }).db;

describe("snapshots on disk", () => {
  it("write atomically, keep the newest few, and read back", () => {
    const dir = tempDir();
    const sim = createSim({ seed: "1", data });
    for (let i = 1; i <= 5; i++) {
      for (let k = 0; k < 12; k++) sim.step();
      writeSnapshot(dir, { header: header(sim), sim: sim.snapshot(), inputSeq: i });
    }
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(KEEP_SNAPSHOTS);
    expect(files.every((f) => /^snap-\d{10}\.v8\.gz$/.test(f))).toBe(true);
    const runs = tempDir();
    writeSnapshot(runDir(runs, "run-20261001-120000-seed1"), { header: header(sim), sim: sim.snapshot(), inputSeq: 5 });
    const latest = latestSnapshot(runs)!;
    expect(latest.state.header.tick).toBe(60);
    expect(latest.state.inputSeq).toBe(5);
    expect(restoreSim(latest.state.sim, data).tick).toBe(60);
  });

  it("skip a snapshot cut short by a crash for the one before it", () => {
    const runs = tempDir();
    const dir = runDir(runs, "run-20261001-120000-seed1");
    const sim = createSim({ seed: "1", data });
    sim.step();
    writeSnapshot(dir, { header: header(sim), sim: sim.snapshot(), inputSeq: 0 });
    writeFileSync(join(dir, "snap-9999999999.v8.gz"), "not a snapshot");
    const latest = latestSnapshot(runs)!;
    expect(latest.state.header.tick).toBe(1);
    expect(latest.skipped).toHaveLength(1);
  });

  it("resume only with the same engine, data, director and seed; otherwise a fresh run the next morning", () => {
    const sim = createSim({ seed: "1", data });
    const h = header(sim, { t: 3 * 86400 + 15 * 3600 }); // Thursday 15:00
    const same = { engineBuild: "e", dataVersion: "d", director: "off", seed: "1" };
    expect(resumeDecision(h, same)).toEqual({ resume: true });
    const changed = resumeDecision(h, { ...same, engineBuild: "x", dataVersion: "y" });
    expect(changed).toEqual({ resume: false, reason: "the engine has changed, the data has changed", startT: 4 * 86400 + 6 * 3600 });
    expect(nextMorning(4 * 86400 + 5 * 3600)).toBe(5 * 86400 + 6 * 3600);
  });

  it("keep only the newest runs, and always the current one", () => {
    const runs = tempDir();
    for (const id of ["run-20261001-010000-seed1", "run-20261002-010000-seed1", "run-20261003-010000-seed1", "run-20261004-010000-seed1"]) writeSnapshotDir(runs, id);
    expect(pruneRuns(runs, 2, "run-20261004-010000-seed1").sort()).toEqual(["run-20261001-010000-seed1", "run-20261002-010000-seed1"]);
    expect(readdirSync(runs).sort()).toEqual(["run-20261003-010000-seed1", "run-20261004-010000-seed1"]);
  });

  it("name the engine build by its source, the same every time", () => {
    expect(engineBuild()).toMatch(/^[0-9a-f]{12}$/);
    expect(engineBuild()).toBe(engineBuild());
  });
});

function writeSnapshotDir(runs: string, id: string): void {
  const dir = runDir(runs, id);
  writeSnapshot(dir, { header: header(createSim({ seed: "1", data }), { runId: id }), sim: createSim({ seed: "1", data }).snapshot(), inputSeq: 0 });
}

describe("the event log on the public server", () => {
  it("cuts back to a snapshot's tick, keeping inputs queued before it", () => {
    const log = new EventLog(":memory:", meta);
    const db = dbOf(log);
    const sim = createSim({ seed: "1", data });
    for (let i = 0; i < 40; i++) log.appendEvents(sim.step());
    log.appendInput({ seq: 1, applyTick: 100, type: "inject_fall", payload: { residentId: "res_win", severity: "minor" }, source: "user" });
    log.appendInput({ seq: 2, applyTick: 41, type: "inject_fall", payload: { residentId: "res_stan", severity: "minor" }, source: "user" });
    log.appendCommand(35, "pause", {});
    const cut = log.truncateAfter(30, 1);
    expect(cut.inputs).toBe(1);
    expect(cut.commands).toBe(1);
    expect((db.prepare("SELECT max(tick) AS m FROM events").get() as { m: number }).m).toBeLessThanOrEqual(30);
    expect((db.prepare("SELECT seq FROM inputs").all() as { seq: number }[]).map((r) => r.seq)).toEqual([1]);
  });

  it("prunes old events, and hands back the last few for new browsers", () => {
    const log = new EventLog(":memory:", meta);
    const sim = createSim({ seed: "1", data });
    for (let i = 0; i < 720; i++) log.appendEvents(sim.step()); // an hour
    const all = rows(dbOf(log)).length;
    const removed = log.prune(108000 + 1800);
    expect(removed).toBeGreaterThan(0);
    expect(rows(dbOf(log)).length).toBe(all - removed);
    const tail = log.tail(5);
    expect(tail).toHaveLength(5);
    expect(tail[4]!.seq).toBe((rows(dbOf(log)).at(-1) as { seq: number }).seq);
    expect(tail[0]!.id).toBe(`e${tail[0]!.seq}`);
  });

  it("resumes a run after a crash with no gap or repeat, and the same log as a run that never stopped", () => {
    const dir = tempDir();
    const path = join(dir, "events.sqlite");
    // Uninterrupted: 900 ticks.
    const whole = new EventLog(join(dir, "whole.sqlite"), meta);
    new Runner(createSim({ seed: "3", data }), data, whole, undefined, { paused: false }).advance(900);
    // Interrupted: 600 ticks, a snapshot at 500, then a "crash" (100 ticks logged after the snapshot).
    const first = new EventLog(path, meta);
    const runner = new Runner(createSim({ seed: "3", data }), data, first, undefined, { paused: false });
    runner.advance(500);
    const saved: SavedState = { header: header(createSim({ seed: "3", data })), ...runner.save() };
    const runs = tempDir();
    writeSnapshot(runDir(runs, "run-20261001-120000-seed3"), { ...saved, header: { ...saved.header, tick: 500 } });
    runner.advance(100);
    first.close();
    // Restart: restore, reopen and cut the log, carry on to 900.
    const latest = latestSnapshot(runs)!;
    const reopened = new EventLog(path, meta, { resume: true });
    reopened.truncateAfter(latest.state.header.tick, latest.state.inputSeq);
    const resumed = new Runner(restoreSim(latest.state.sim, data), data, reopened, undefined, { paused: false, recent: reopened.tail(300), inputSeq: latest.state.inputSeq });
    resumed.advance(400);
    const a = rows(dbOf(whole));
    const b = rows(dbOf(reopened));
    expect(b.map((r) => (r as { seq: number }).seq)).toEqual(b.map((_, i) => i + 1)); // gap-free
    expect(b).toEqual(a);
    // A browser connecting after the restart sees the recent events and the running clock.
    const received: ServerMessage[] = [];
    resumed.connect({ send: (m) => received.push(m), role: "viewer" });
    const snap = received[0] as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snap.role).toBe("viewer");
    expect(snap.clock.paused).toBe(false);
    expect(snap.events.length).toBeGreaterThan(0);
  }, 60_000);
});

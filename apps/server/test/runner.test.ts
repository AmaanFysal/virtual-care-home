import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@vch/shared-types";
import { createSim } from "@vch/sim-engine";
import { loadWorldData } from "@vch/sim-engine/load-data";
import { EventLog } from "../src/eventlog.js";
import { Runner, parseCommand } from "../src/runner.js";

const data = loadWorldData();

function setup() {
  const log = new EventLog(":memory:", { runId: "test", seed: "1", startT: 108000, dataVersion: "x", createdWallclock: "now" });
  // Reach into the same in-memory database for assertions.
  const db = (log as unknown as { db: DatabaseSync }).db;
  const runner = new Runner(createSim({ seed: "1", data }), data, log);
  const received: ServerMessage[] = [];
  runner.connect({ send: (m) => received.push(m) });
  return { runner, db, received };
}

describe("Runner", () => {
  it("sends a full snapshot on connect, paused", () => {
    const { received } = setup();
    expect(received[0]!.type).toBe("snapshot");
    const snapshot = received[0] as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snapshot.clock.paused).toBe(true);
    expect(snapshot.people.filter((p) => p.onMap).map((p) => p.id)).toContain("stf_florin");
    expect(snapshot.floorplan.rooms).toHaveLength(6);
  });

  it("paces ticks by speed and real time", () => {
    const { runner } = setup();
    runner.handle({ type: "set_speed", speed: 60 });
    runner.handle({ type: "resume" });
    runner.frame(0);
    for (let ms = 100; ms <= 1000; ms += 100) runner.frame(ms);
    // 60x = 12 ticks per real second; the first frame counts as 100 ms.
    expect(runner.clock().tick).toBe(13);
  });

  it("logs every event, and sends only changed people in deltas", () => {
    const { runner, db, received } = setup();
    runner.advance(12 * 60 * 2); // to 08:00
    runner.frame(0);
    const delta = received.at(-1) as Extract<ServerMessage, { type: "delta" }>;
    expect(delta.type).toBe("delta");
    expect(delta.people.length).toBeGreaterThan(0);
    expect(delta.people.length).toBeLessThan(runner.clock().tick); // compact, not everyone every tick
    const count = db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    expect(count.n).toBe(delta.events.length);
    const sent = received.length;
    runner.frame(100);
    expect(received.length).toBe(sent); // paused and nothing changed: nothing sent
  });

  it("logs an injected fall as an input before the engine applies it", () => {
    const { runner, db } = setup();
    runner.handle({ type: "inject_fall", residentId: "res_peggy", severity: "serious" });
    const input = db.prepare("SELECT * FROM inputs").get() as Record<string, unknown>;
    expect(input).toMatchObject({ seq: 1, apply_tick: 1, type: "inject_fall", source: "user" });
    runner.handle({ type: "step" });
    const fell = db.prepare("SELECT * FROM events WHERE type = 'resident.fell'").get() as Record<string, unknown>;
    expect(fell).toMatchObject({ tick: 1, source: "user" });
  });

  it("refuses to step while running and answers inspect", () => {
    const { runner } = setup();
    runner.handle({ type: "resume" });
    expect(runner.handle({ type: "step" })).toMatchObject({ type: "error" });
    const reply = runner.handle({ type: "inspect", personId: "res_raj" });
    expect(reply).toMatchObject({ type: "detail", detail: { person: { id: "res_raj" } } });
  });
});

describe("parseCommand", () => {
  it("accepts valid commands and rejects anything else", () => {
    expect(parseCommand('{"type":"set_speed","speed":360}')).toEqual({ type: "set_speed", speed: 360 });
    expect(parseCommand('{"type":"set_speed","speed":7}')).toBeNull();
    expect(parseCommand('{"type":"inject_fall","residentId":"res_win","severity":"minor"}')).toMatchObject({ type: "inject_fall" });
    expect(parseCommand('{"type":"inject_fall","residentId":"res_win","severity":"awful"}')).toBeNull();
    expect(parseCommand("not json")).toBeNull();
    expect(parseCommand('{"type":"teleport"}')).toBeNull();
  });
});

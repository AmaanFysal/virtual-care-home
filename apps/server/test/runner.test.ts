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
    expect(snapshot.floorplan.rooms).toHaveLength(17); // six single bedrooms and their en-suites, corridor, Lounge, waiting area, reception, staff room
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

  it("applies an inject command from the Director panel as a logged user input, and refuses bad params", () => {
    const { runner, db, received } = setup();
    expect(runner.handle({ type: "inject", input: "staff_sick", params: { staffId: "stf_nobody" } })).toMatchObject({ type: "error" });
    expect(runner.handle({ type: "inject", input: "staff_sick", params: { staffId: "stf_dave", cover: "agency" } })).toBeNull();
    const input = db.prepare("SELECT * FROM inputs").get() as Record<string, unknown>;
    expect(input).toMatchObject({ seq: 1, apply_tick: 1, type: "staff_sick", source: "user" });
    runner.handle({ type: "step" });
    const absent = db.prepare("SELECT * FROM events WHERE type = 'staff.absent'").get() as Record<string, unknown>;
    expect(absent).toMatchObject({ tick: 1, source: "user" });
    expect(JSON.parse(String(absent.payload))).toMatchObject({ staffId: "stf_dave", slot: "late.lead" });
    const snapshot = received[0] as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snapshot.director).toEqual({ mode: "off", scenario: null, deaths: true });
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
    expect(parseCommand('{"type":"inject","input":"shift_no_show","params":{"slot":"night.carer"}}')).toMatchObject({ type: "inject", input: "shift_no_show" });
    expect(parseCommand('{"type":"inject","input":"outbreak","params":{}}')).toBeNull();
    expect(parseCommand('{"type":"inject","input":"staff_sick"}')).toBeNull();
  });
});

describe("inspect detail", () => {
  it("includes a resident's needs and a staff member's workload and task", () => {
    const { runner } = setup();
    runner.advance(12 * 60 * 3); // to 09:00
    const resident = runner.handle({ type: "inspect", personId: "res_peggy" }) as Extract<ServerMessage, { type: "detail" }>;
    expect(Object.keys(resident.detail.needs!)).toEqual(["hunger", "thirst", "toileting", "fatigue", "social"]);
    const staff = runner.handle({ type: "inspect", personId: "stf_blessing" }) as Extract<ServerMessage, { type: "detail" }>;
    expect(staff.detail.workload).toBeGreaterThanOrEqual(0);
    expect(staff.detail.schedule.map((s) => s.label)).toContain("early shift ends");
  });
});

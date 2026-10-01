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

describe("the building (v1.0-testbed)", () => {
  it("is in the snapshot: doors, windows and the weather", () => {
    const { received } = setup();
    const snapshot = received[0] as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snapshot.building.doors.find((d) => d.doorId === "D_Exit")).toMatchObject({ state: "locked" });
    expect(snapshot.building.windows).toHaveLength(12);
    expect(snapshot.building.weather?.time).toBe("2025-11-03T06:00");
    expect(snapshot.building.equipment.find((e) => e.equipmentId === "Lounge.radiator1")).toMatchObject({ on: true, setpointC: 22 });
  });

  it("sends only the doors and windows that changed, and the weather when its hour changes", () => {
    const { runner, received } = setup();
    runner.advance(12 * 60 * 2); // to 08:00: bedroom doors open for the day, the Lounge's held open
    runner.frame(0);
    const delta = received.at(-1) as Extract<ServerMessage, { type: "delta" }>;
    expect(delta.building?.doors?.length).toBeGreaterThan(0);
    expect(delta.building!.doors!.length).toBeLessThan(18);
    expect(delta.building?.weather?.time).toBe("2025-11-03T08:00");
    runner.handle({ type: "step" });
    runner.frame(100);
    const next = received.at(-1) as Extract<ServerMessage, { type: "delta" }>;
    expect(next.building?.weather).toBeUndefined();
  });

  it("answers inspect_room with the room's world description, and a person's detail with their activity", () => {
    const { runner } = setup();
    runner.advance(12 * 60 * 2);
    const reply = runner.handle({ type: "inspect_room", roomId: "Room5" }) as Extract<ServerMessage, { type: "room" }>;
    expect(reply.type).toBe("room");
    expect(reply.room.doors.map((d) => d.doorId).sort()).toEqual(["D_Ensuite5", "D_Room5"]);
    expect(reply.room.people.every((p) => p.met > 0 && p.name.length > 0)).toBe(true);
    expect(runner.handle({ type: "inspect_room", roomId: "Attic" })).toMatchObject({ type: "error" });
    const detail = runner.handle({ type: "inspect", personId: "stf_blessing" }) as Extract<ServerMessage, { type: "detail" }>;
    expect(detail.detail.activity).toMatchObject({ personId: "stf_blessing" });
    const home = runner.handle({ type: "inspect", personId: "stf_florin" }) as Extract<ServerMessage, { type: "detail" }>;
    expect(home.detail.activity).toBeNull(); // the night carer has gone home
    expect(reply.room.equipment.map((e) => e.equipmentId)).toEqual(expect.arrayContaining(["Room5.light", "Ensuite5.wc", "Room5.radiator"]));
    expect(Array.isArray(detail.detail.touches)).toBe(true);
    expect(parseCommand('{"type":"inspect_room","roomId":"Lounge"}')).toEqual({ type: "inspect_room", roomId: "Lounge" });
    expect(parseCommand('{"type":"inspect_room"}')).toBeNull();
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

describe("roles (docs/08)", () => {
  it("makes every connection an admin by default, as in local dev, paused with every control", () => {
    const { runner, received } = setup();
    expect((received[0] as Extract<ServerMessage, { type: "snapshot" }>).role).toBe("admin");
    expect(runner.handle({ type: "set_speed", speed: 360 })).toBeNull();
    expect(runner.handle({ type: "resume" })).toBeNull();
    expect(runner.clock()).toMatchObject({ paused: false, speed: 360 });
  });

  it("lets viewers watch and inspect, and nothing else", () => {
    const log = new EventLog(":memory:", { runId: "test", seed: "1", startT: 108000, dataVersion: "x", createdWallclock: "now" });
    const db = (log as unknown as { db: DatabaseSync }).db;
    const runner = new Runner(createSim({ seed: "1", data }), data, log, undefined, { paused: false, speed: 10 });
    const received: ServerMessage[] = [];
    runner.connect({ send: (m) => received.push(m), role: "viewer" });
    const snapshot = received[0] as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snapshot.role).toBe("viewer");
    expect(snapshot.clock).toMatchObject({ paused: false, speed: 10 });
    for (const command of [
      { type: "pause" },
      { type: "resume" },
      { type: "step" },
      { type: "set_speed", speed: 360 },
      { type: "inject_fall", residentId: "res_win", severity: "serious" },
      { type: "inject", input: "staff_sick", params: { staffId: "stf_maria" } },
    ] as const)
      expect(runner.handle(command, "viewer"), command.type).toEqual({ type: "error", message: "Admin only" });
    expect(runner.clock()).toMatchObject({ paused: false, speed: 10 });
    expect(runner.handle({ type: "inspect", personId: "res_peggy" }, "viewer")?.type).toBe("detail");
    expect(runner.handle({ type: "inspect_room", roomId: "Lounge" }, "viewer")?.type).toBe("room");
    // Nothing a viewer sent was logged; an admin's command is, with its role.
    expect(db.prepare("SELECT count(*) AS n FROM commands").get()).toEqual({ n: 0 });
    runner.handle({ type: "pause" }, "admin");
    expect(JSON.parse((db.prepare("SELECT payload FROM commands").get() as { payload: string }).payload)).toEqual({ type: "pause", role: "admin" });
  });

  it("parses auth, and never accepts it as a runner command", () => {
    expect(parseCommand('{"type":"auth","token":"abc"}')).toEqual({ type: "auth", token: "abc" });
    expect(parseCommand('{"type":"auth","token":""}')).toBeNull();
    expect(parseCommand(JSON.stringify({ type: "auth", token: "x".repeat(300) }))).toBeNull();
    const { runner } = setup();
    expect(runner.handle({ type: "auth", token: "abc" })?.type).toBe("error");
  });

  it("skips a viewer too slow to keep up, sends it a fresh snapshot once it has caught up, and closes it if it never does", () => {
    const { runner } = setup();
    let backlog = 0;
    let closed = "";
    const got: string[] = [];
    runner.connect({ send: (m) => got.push(m.type), buffered: () => backlog, close: (r) => (closed = r) });
    runner.handle({ type: "resume" });
    got.splice(1); // the clock message for resuming
    backlog = 2 * 1024 * 1024;
    runner.frame(0);
    runner.frame(100);
    expect(got).toEqual(["snapshot"]);
    backlog = 0;
    runner.frame(200);
    expect(got).toEqual(["snapshot", "snapshot"]);
    backlog = 2 * 1024 * 1024;
    for (let ms = 300; ms <= 31_000; ms += 100) runner.frame(ms);
    expect(closed).toMatch(/too slow/);
  });
});

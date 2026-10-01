import { describe, expect, it } from "vitest";
import type { PersonView } from "@vch/shared-types";
import { initialState, reduce } from "../src/store";
import { darkness, nightFactor } from "../src/canvas/renderer";

const person = (id: string, x: number): PersonView => ({ id, kind: "staff", name: id, initials: "X", gender: "female", onMap: true, x, y: 1, roomId: "Corridor", posture: "standing", badges: [], task: null });
const clock = { t: 108000, tick: 0, paused: false, speed: 60 as const };
const door = (doorId: string, state: "open" | "closed") => ({ doorId, rooms: ["Room1", "Corridor"] as [string, string], state, heldBy: null });
const light = (on: boolean) => ({ equipmentId: "Room1.light", kind: "light" as const, roomId: "Room1", on });
const building = { doors: [door("D_Room1", "closed"), door("D_Room2", "open")], windows: [{ windowId: "Window_Room1", roomId: "Room1", state: "closed" as const, openingMm: 0 }], equipment: [light(false)], weather: null };

describe("store", () => {
  it("replaces state on snapshot and merges deltas", () => {
    let state = { ...initialState, ...reduce(initialState, { type: "snapshot", clock, floorplan: {} as never, people: [person("a", 1), person("b", 2)], events: [], director: { mode: "off", scenario: null, deaths: true }, building, role: "admin" }) };
    state = { ...state, ...reduce(state, { type: "delta", clock: { ...clock, tick: 1 }, people: [person("b", 3)], events: [] }) };
    expect(state.people.a!.x).toBe(1);
    expect(state.people.b!.x).toBe(3);
    expect(state.clock!.tick).toBe(1);
  });
});

describe("the building in the store (v1.0-testbed)", () => {
  it("takes the building from the snapshot and applies only what a delta changed", () => {
    let state = { ...initialState, ...reduce(initialState, { type: "snapshot", clock, floorplan: {} as never, people: [], events: [], director: { mode: "off", scenario: null, deaths: true }, building, role: "admin" }) };
    state = { ...state, ...reduce(state, { type: "delta", clock, people: [], events: [], building: { doors: [door("D_Room1", "open")], equipment: [light(true)] } }) };
    expect(state.building!.doors.map((d) => d.state)).toEqual(["open", "open"]);
    expect(state.building!.equipment[0]!.on).toBe(true);
    expect(state.building!.windows).toEqual(building.windows);
  });

  it("keeps a room's detail only while that room is selected", () => {
    const room = { roomId: "Room5", name: "Room 5", kind: "bedroom", areaM2: 19, ceilingM: 2.4, t: 1, doors: [], windows: [], equipment: [], people: [], touches: [], weather: null };
    expect(reduce({ ...initialState, selectedRoomId: "Room5" }, { type: "room", room })).toEqual({ roomDetail: room });
    expect(reduce({ ...initialState, selectedRoomId: "Lounge" }, { type: "room", room })).toEqual({});
  });
});

describe("night dimming", () => {
  it("is dark at night, light by day, and ramps at dusk and dawn", () => {
    expect(nightFactor(86400 + 2 * 3600)).toBe(1);
    expect(nightFactor(86400 + 12 * 3600)).toBe(0);
    expect(nightFactor(86400 + 21 * 3600)).toBeCloseTo(0.5);
    expect(nightFactor(86400 + 6.75 * 3600)).toBeCloseTo(0.5);
  });
});

describe("darkness outside (v1.0-testbed)", () => {
  it("follows the hour's real weather: dark after sunset, partly in a dim hour, light by day; the clock without weather", () => {
    expect(darkness(86400 + 17 * 3600, { isDay: false, shortwaveWm2: 0 })).toBe(1);
    expect(darkness(86400 + 12 * 3600, { isDay: true, shortwaveWm2: 300 })).toBe(0);
    expect(darkness(86400 + 8 * 3600, { isDay: true, shortwaveWm2: 30 })).toBeCloseTo(0.3);
    expect(darkness(86400 + 2 * 3600, null)).toBe(1);
  });
});

describe("roles in the store (docs/08)", () => {
  const snapshot = (role: "viewer" | "admin") => ({ type: "snapshot" as const, clock, floorplan: {} as never, people: [], events: [], director: { mode: "off" as const, scenario: null, deaths: true }, building, role });

  it("starts as a viewer and takes the role the server gives", () => {
    expect(initialState.role).toBe("viewer");
    expect(reduce(initialState, snapshot("admin")).role).toBe("admin"); // local dev
    expect(reduce(initialState, snapshot("viewer")).role).toBe("viewer"); // the public server
  });

  it("becomes an admin when the token is accepted, and says why when it isn't", () => {
    const viewer = { ...initialState, ...reduce(initialState, snapshot("viewer")) };
    expect(reduce(viewer, { type: "auth", ok: false, role: "viewer", message: "Wrong token" })).toEqual({ role: "viewer", authMessage: "Wrong token" });
    expect(reduce(viewer, { type: "auth", ok: true, role: "admin" })).toEqual({ role: "admin", authMessage: null });
  });
});

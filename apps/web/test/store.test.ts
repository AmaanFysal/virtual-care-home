import { describe, expect, it } from "vitest";
import type { PersonView } from "@vch/shared-types";
import { initialState, reduce } from "../src/store";
import { nightFactor } from "../src/canvas/renderer";

const person = (id: string, x: number): PersonView => ({ id, kind: "staff", name: id, initials: "X", gender: "female", onMap: true, x, y: 1, roomId: "Corridor", posture: "standing", badges: [], task: null });
const clock = { t: 108000, tick: 0, paused: false, speed: 60 as const };

describe("store", () => {
  it("replaces state on snapshot and merges deltas", () => {
    let state = { ...initialState, ...reduce(initialState, { type: "snapshot", clock, floorplan: {} as never, people: [person("a", 1), person("b", 2)], events: [], director: { mode: "off", scenario: null, deaths: true } }) };
    state = { ...state, ...reduce(state, { type: "delta", clock: { ...clock, tick: 1 }, people: [person("b", 3)], events: [] }) };
    expect(state.people.a!.x).toBe(1);
    expect(state.people.b!.x).toBe(3);
    expect(state.clock!.tick).toBe(1);
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

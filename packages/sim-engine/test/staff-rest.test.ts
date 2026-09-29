// Where staff rest and stand (docs/05 "Breaks" and "Night break", docs/04 "Standing and sitting"):
// - staff never sit on a WC; restocking an en-suite is done standing beside the toilet;
// - every break is in the staff room, never the waiting area or anywhere else;
// - the lone night carer gets one break a night, in the staff room, while the floating night
//   carer covers the wing, after the two-person work of her round;
// - the floor rule holds throughout, and Dennis's turns still have two people.

import { describe, expect, it } from "vitest";
import { TICK_SECONDS, timeOfDay, type AnySimEvent, type SimEvent } from "@vch/shared-types";
import { checkInvariants, createSim } from "../src/index.js";
import { NIGHT_BREAK_MINS } from "../src/tasks.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const DAY = 86400 / TICK_SECONDS;
const wcPoints = data.floorplan.points.filter((p) => p.kind === "wc");

describe.each(["1", "2", "3"])("a week of staff rest and WC use (seed %s)", (seed) => {
  const sim = createSim({ seed, data });
  const w = sim.world;
  const events: AnySimEvent[] = [];
  const staffOnWc: string[] = [];
  const breaksOutside: string[] = [];
  const uncoveredDuringNightBreak: string[] = [];
  let restockedStanding = 0;
  let nightBreakTicks = 0;
  for (let i = 0; i < 7 * DAY; i++) {
    events.push(...sim.step());
    for (const p of w.people.values()) {
      if (!p.staff || !p.onMap) continue;
      const onSeat = wcPoints.some((wc) => Math.abs(p.x - wc.x) < 1e-6 && Math.abs(p.y - wc.y) < 1e-6);
      if (onSeat || (p.posture === "sitting" && wcPoints.some((wc) => wc.id === p.atPoint))) staffOnWc.push(`${p.id} ${p.posture} at ${p.atPoint} t=${w.t}`);
      const task = p.staff.taskId ? w.tasks.get(p.staff.taskId) : undefined;
      if (task?.kind === "idle" && task.data.activity === "restock" && !p.move && p.posture === "standing") restockedStanding += 1;
      // On a break (resting, not walking to or from it): in the staff room.
      if (task?.kind === "break" && task.startedT !== null && !p.move && p.roomId !== "StaffRoom") breaksOutside.push(`${p.id} in ${p.roomId} t=${w.t}`);
      if (task?.kind === "break" && task.data.night === 1) {
        nightBreakTicks += 1;
        if (checkInvariants(w).some((v) => v.rule === "floor_cover")) uncoveredDuringNightBreak.push(`t=${w.t}`);
      }
    }
  }
  const ofType = <K extends AnySimEvent["type"]>(type: K) => events.filter((e) => e.type === type) as SimEvent<K>[];

  it("never has a staff member sitting on, or standing on, a WC seat; restocking is done standing beside it", () => {
    expect(staffOnWc.slice(0, 5)).toEqual([]);
    expect(restockedStanding).toBeGreaterThan(0);
  });

  it("never has a staff member on a break outside the staff room", () => {
    expect(breaksOutside.slice(0, 5)).toEqual([]);
    for (const e of ofType("break.started")) expect(e.payload.pointId.startsWith("StaffRoom."), e.payload.pointId).toBe(true);
  });

  it("gives every night carer one staff-room break a night, while the floating carer is on the wing", () => {
    // Whole night shifts in the week: started and ended within the run.
    const nightShifts = ofType("shift.started")
      .filter((e) => e.payload.shift === "night")
      .map((e) => ({ staffId: e.payload.staffId, startT: e.t, endT: ofType("shift.ended").find((x) => x.payload.staffId === e.payload.staffId && x.payload.shift === "night" && x.t > e.t)?.t }))
      .filter((n): n is { staffId: string; startT: number; endT: number } => n.endT !== undefined);
    expect(nightShifts.length).toBeGreaterThanOrEqual(6);
    for (const n of nightShifts) {
      const breaks = ofType("break.started").filter((e) => e.payload.staffId === n.staffId && e.t >= n.startT && e.t < n.endT);
      expect(breaks.length, `${n.staffId}, night from t=${n.startT}`).toBe(1);
      const start = breaks[0]!.t;
      const end = ofType("break.ended").find((e) => e.payload.staffId === n.staffId && e.t > start)!.t;
      expect(end - start).toBeGreaterThanOrEqual(20 * 60);
      // She arrived before it started and left after it ended.
      const arrived = ofType("second_carer.arrived").filter((e) => e.t <= start).at(-1)!;
      const departed = ofType("second_carer.departed").find((e) => e.t >= arrived.t)!;
      expect(departed.t).toBeGreaterThanOrEqual(end);
      expect(arrived.payload.planned).toBe(true);
    }
    expect(nightBreakTicks).toBeGreaterThan(0);
    expect(NIGHT_BREAK_MINS).toBeGreaterThanOrEqual(20);
    expect(NIGHT_BREAK_MINS).toBeLessThanOrEqual(30);
  });

  it("keeps the floor covered at every tick of every night break", () => {
    expect(uncoveredDuringNightBreak.slice(0, 5)).toEqual([]);
    expect(ofType("invariant.violated")).toEqual([]);
  });

  it("still turns Dennis with two people, every time", () => {
    const turns = ofType("task.completed").filter((e) => e.payload.kind === "care.reposition" && e.payload.residentId === "res_dennis");
    expect(turns.length).toBeGreaterThan(7 * 8);
    for (const t of turns) expect(t.actors.filter((id) => id !== "res_dennis").length, `turn at ${timeOfDay(t.t)}`).toBeGreaterThanOrEqual(2);
  });
});

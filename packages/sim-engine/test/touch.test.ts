// Touches (v1.0-testbed PR 2): every touch is by someone there, on something that exists, within
// reach; and a day has the touches you'd expect.

import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY, TICK_SECONDS, type Touch } from "@vch/shared-types";
import { createSim } from "../src/index.js";
import { REACH_M, distanceTo } from "../src/touches.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const DAY = SECONDS_PER_DAY / TICK_SECONDS;

/** Objects touched from where the person was a moment ago: the WC and basin as they set off back, the keypad on the way out. */
const FROM_BEFORE = /(\.wc|\.basin|\.keypad)$/;

describe("touches", () => {
  it.each(["1", "5"])("are by someone there, on a known object, within reach, for a day (seed %s)", (seed) => {
    const sim = createSim({ seed, data });
    const problems: string[] = [];
    const all: Touch[] = [];
    for (let i = 0; i < DAY; i++) {
      sim.step();
      for (const t of sim.describe().touches) {
        all.push(t);
        const p = sim.world.people.get(t.personId);
        const o = sim.world.building!.objects.get(t.objectId);
        if (!p || !o) {
          problems.push(`unknown ${!p ? t.personId : t.objectId}`);
          continue;
        }
        if (t.t !== sim.t) problems.push(`${t.objectId} touched at ${t.t}, described at ${sim.t}`);
        if (FROM_BEFORE.test(t.objectId)) continue;
        if (!p.onMap) problems.push(`${t.personId} touched ${t.objectId} off the map`);
        const d = distanceTo(sim.world, p, o);
        if (d > REACH_M) problems.push(`${t.personId} touched ${t.objectId} from ${d.toFixed(2)} m`);
      }
    }
    expect([...new Set(problems)].slice(0, 10)).toEqual([]);
    // A day: several hundred touches, on the kinds of thing care involves.
    expect(all.length).toBeGreaterThan(400);
    expect(all.length).toBeLessThan(1500);
    const kinds = new Set(all.map((t) => t.objectId.replace(/^res_\w+\./, "res.").replace(/\d/g, "N")));
    for (const k of ["RoomN.Bed.bed", "res.cup", "res.tray", "EnsuiteN.wc", "EnsuiteN.basin", "D_RoomN.handle", "D_Exit.keypad", "med_trolley", "StaffRoom.kettle", "Reception.visitors_book"]) expect(kinds).toContain(k);
  }, 60000);

  it("keeps the last 20 by room and by person, newest first", () => {
    const sim = createSim({ seed: "1", data });
    for (let i = 0; i < 12 * 60 * 3; i++) sim.step(); // to 09:00
    const room = sim.describeRoom("Room5")!;
    expect(room.touches.length).toBeGreaterThan(0);
    expect(room.touches.length).toBeLessThanOrEqual(20);
    expect(room.touches.map((t) => t.t)).toEqual([...room.touches.map((t) => t.t)].sort((a, b) => b - a));
    for (const list of sim.world.building!.recentByPerson.values()) expect(list.length).toBeLessThanOrEqual(20);
  });
});

import { describe, expect, it } from "vitest";
import { TICK_SECONDS, type AnySimEvent } from "@vch/shared-types";
import { createSim } from "../src/index.js";
import { isCareStaff } from "../src/state.js";
import { createAssist } from "../src/tasks.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const DAY = (24 * 3600) / TICK_SECONDS;

describe("idle behaviour", () => {
  it("fills free time with low-priority work on the floor, not standing in the corridor", () => {
    const sim = createSim({ seed: "1", data });
    const counts = { idle: 0, standing: 0, total: 0 };
    const activities = new Set<string>();
    for (let i = 0; i < DAY; i++) {
      sim.step();
      if (sim.t % 60 !== 0) continue;
      for (const p of sim.world.people.values()) {
        if (!p.onMap || !isCareStaff(p) || p.kind === "external" || p.staff!.duty !== "on_shift") continue;
        counts.total += 1;
        const task = p.staff!.taskId ? sim.world.tasks.get(p.staff!.taskId) : undefined;
        if (task?.kind === "idle") {
          counts.idle += 1;
          activities.add(String(task.data.activity));
          expect(sim.world.points.get(String(task.data.point))!.room).not.toBe("StaffRoom"); // done on the floor
        }
        if (!task && !p.move) counts.standing += 1;
      }
    }
    expect(counts.idle / counts.total).toBeGreaterThan(0.2);
    expect(counts.standing / counts.total).toBeLessThan(0.05);
    // Plus the floor cover's round of checks during handovers, and keeping an eye on the Lounge.
    // Sitting with a lonely resident is checked over a week below: company in the Lounge now meets
    // most social need, so whether it happens on day 1 is down to chance.
    expect([...activities].filter((a) => a !== "sit_with").sort()).toEqual(["checks", "notes", "restock", "supervise", "tidy"]);
  });

  it("still sits with lonely residents over a week", () => {
    const sim = createSim({ seed: "1", data });
    const sitWith = new Set<string>();
    for (let i = 0; i < 7 * DAY; i++) {
      sim.step();
      for (const t of sim.world.tasks.values()) if (t.kind === "idle" && t.data.activity === "sit_with") sitWith.add(t.id);
    }
    expect(sitWith.size).toBeGreaterThanOrEqual(5);
  });

  it("drops an idle activity at once for a help request", () => {
    const sim = createSim({ seed: "1", data });
    for (let i = 0; i < DAY / 2; i++) sim.step(); // 18:00
    // Wait for a moment when every free carer is on an idle activity.
    let idleStaff: string[] = [];
    for (let i = 0; i < 12 * 60 && idleStaff.length === 0; i++) {
      sim.step();
      if (sim.t % 60 !== 0) continue;
      idleStaff = [...sim.world.people.values()].filter((p) => p.staff?.taskId && sim.world.tasks.get(p.staff.taskId)?.kind === "idle").map((p) => p.id);
    }
    expect(idleStaff.length).toBeGreaterThan(0);
    const task = createAssist(sim.world, sim.world.people.get("res_arthur")!, "thirst");
    const events: AnySimEvent[] = [];
    for (let i = 0; i < 12; i++) events.push(...sim.step());
    const assigned = events.find((e) => e.type === "task.assigned" && e.payload.taskId === task.id);
    expect(assigned, "assigned within a minute").toBeDefined();
  });

  it("all but removes requests for company", () => {
    const sim = createSim({ seed: "1", data });
    const events: AnySimEvent[] = [];
    for (let i = 0; i < 7 * DAY; i++) events.push(...sim.step());
    const social = events.filter((e) => e.type === "resident.requested_help" && e.payload.need === "social");
    expect(social.length).toBeLessThanOrEqual(2);
  });
});

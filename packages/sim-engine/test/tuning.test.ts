// The tuning review (docs/12, sub-milestone e): the rules it added. The only people free for a
// pressing turn keep to short work (Dennis's turns before the morning handover once Kamala has
// moved in), and a day break or going home counts only staff on a shift as floor cover.

import { describe, expect, it } from "vitest";
import { TICK_SECONDS, formatSimTime } from "@vch/shared-types";
import { checkInvariants, createSim } from "../src/index.js";
import { coveredWithout } from "../src/floor.js";
import type { Tuning } from "../src/tuning.js";
import { loadAdmissions, loadDirectorConfig, loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const config = loadDirectorConfig();
const admissions = loadAdmissions();

/** A week with Kamala in Raj's room from the start: Dennis's missed turns and any hard violations. */
function kamalaWeek(seed: string, tuning: Partial<Tuning> = {}): { turns: string[]; hard: string[] } {
  const sim = createSim({ seed, data, config, admissions, tuning });
  const raj = sim.world.people.get("res_raj")!;
  Object.assign(raj, { onMap: false, roomId: null, atPoint: null, move: null });
  raj.resident!.away = "died";
  for (const t of [...sim.world.tasks.values()]) if (t.residentId === "res_raj") sim.world.tasks.delete(t.id);
  sim.enqueue({ seq: 1, applyTick: 2, type: "admission", payload: { cardId: "adm_kamala" }, source: "user" });
  const turns: string[] = [];
  const hard: string[] = [];
  for (let i = 0; i < (7 * 86400) / TICK_SECONDS; i++) {
    for (const e of sim.step()) if (e.type === "sla.breached" && e.payload.target === "reposition" && e.payload.residentId === "res_dennis") turns.push(formatSimTime(e.t));
    for (const v of checkInvariants(sim.world)) hard.push(`${formatSimTime(sim.t)} ${v.rule}`);
  }
  return { turns, hard };
}

describe("the only people free for a pressing turn", () => {
  it("keep to short work: with Kamala in, Dennis's turns before the morning handover aren't missed", () => {
    const seeds = ["1", "2", "3", "4"];
    const withRule = seeds.map((s) => kamalaWeek(s));
    const without = seeds.map((s) => kamalaWeek(s, { turn_team: false }));
    // Missed turns just before the 07:00 handover (06:30 to 07:00).
    const beforeHandover = (xs: { turns: string[] }[]) => xs.flatMap((x) => x.turns).filter((t) => /06:[3-5]\d$/.test(t)).length;
    // Without it, the floating carer takes Kamala's 20-minute morning care at about 06:36 and the
    // 06:50 turn waits (docs/12).
    expect(beforeHandover(without)).toBeGreaterThanOrEqual(2);
    expect(beforeHandover(withRule)).toBe(0);
    for (const x of withRule) expect(x.hard).toEqual([]);
  }, 120000);
});

describe("floor cover for a break or going home", () => {
  it("counts only staff on a shift, not a helper who leaves when their job is done", () => {
    const sim = createSim({ seed: "1", data, config, admissions });
    const w = sim.world;
    const night = [...w.people.values()].find((p) => p.staff?.shift?.shift === "night" && p.onMap)!;
    // The floating carer on the wing on a visit: on the floor, with no shift of her own.
    const lorna = w.people.get(data.rota.night_float.id)!;
    Object.assign(lorna, { onMap: true, roomId: "Corridor", x: night.x, y: night.y });
    lorna.staff!.duty = "on_shift";
    expect(lorna.staff!.shift).toBeNull();
    expect(coveredWithout(w, night)).toBe(true);
    expect(coveredWithout(w, night, false, undefined, true)).toBe(false);
  });
});

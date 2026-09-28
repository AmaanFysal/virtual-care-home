import { describe, expect, it } from "vitest";
import { TICK_SECONDS, type AnySimEvent, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { act, cond, leaf, newBtState, sel, seq, tickTree, until } from "../src/bt.js";
import { checkInvariants, createSim, type Sim } from "../src/index.js";
import { cellAt } from "../src/world/grid.js";
import { placeAt, walkTo } from "../src/world/movement.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const HOUR = 3600 / TICK_SECONDS;

function run(sim: Sim, hours: number, each?: (sim: Sim) => void): AnySimEvent[] {
  const all: AnySimEvent[] = [];
  for (let i = 0; i < hours * HOUR; i++) {
    all.push(...sim.step());
    each?.(sim);
  }
  return all;
}

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

const clock = (t: number) => {
  const s = ((t % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
};

describe("behaviour tree runtime", () => {
  type C = { log: string[]; n: number };

  it("runs a sequence in order and resumes where it left off", () => {
    const tree = seq<C>(
      "root",
      act("a", (c) => c.log.push("a")),
      until("wait for n>=2", (c) => c.n >= 2),
      act("b", (c) => c.log.push("b")),
    );
    const ctx: C = { log: [], n: 0 };
    const state = newBtState();
    expect(tickTree(tree, ctx, state)).toBe("running");
    ctx.n = 2;
    expect(tickTree(tree, ctx, state)).toBe("success");
    expect(ctx.log).toEqual(["a", "b"]); // "a" did not run twice
  });

  it("falls through a selector to the first child that succeeds", () => {
    const tree = sel<C>("root", cond("no", () => false), act("yes", (c) => c.log.push("yes")));
    const ctx: C = { log: [], n: 0 };
    expect(tickTree(tree, ctx, newBtState())).toBe("success");
    expect(ctx.log).toEqual(["yes"]);
  });

  it("keeps leaf memory while running and clears it when done", () => {
    const tree = seq<C>("root", leaf("count", (c, mem) => ((mem.i = (mem.i ?? 0) + 1), mem.i! >= 3 ? "success" : "running")));
    const state = newBtState();
    const ctx: C = { log: [], n: 0 };
    expect(tickTree(tree, ctx, state)).toBe("running");
    expect(tickTree(tree, ctx, state)).toBe("running");
    expect(tickTree(tree, ctx, state)).toBe("success");
    expect(state.mem).toEqual({});
    expect(state.node).toBe("count");
  });
});

describe("standing spots", () => {
  it("sends people bound for the same point to different nearby cells in the same room", () => {
    const sim = createSim({ seed: "1", data });
    const w = sim.world;
    const people = ["stf_joanne", "stf_bev", "stf_sanjay"].map((id) => w.people.get(id)!);
    people.forEach((p, i) => placeAt(w, p, ["Reception.Desk", "Reception.Office", "Reception.DeskStaff"][i]!));
    for (const p of people) walkTo(w, p, "WaitingArea.Seat3");
    run(sim, 0.1);
    const cells = people.map((p) => cellAt(w.grid, p.x, p.y));
    expect(new Set(cells).size).toBe(3);
    for (const p of people) {
      expect(p.move).toBeNull();
      expect(p.roomId).toBe("WaitingArea");
      expect(Math.hypot(p.x - 5.25, p.y - 10.25)).toBeLessThan(1.6);
    }
    // Exactly one of them got the seat itself.
    expect(people.filter((p) => p.x === 5.25 && p.y === 10.25)).toHaveLength(1);
  });
});

describe("a week on the wing (seed 1)", () => {
  const sim = createSim({ seed: "1", data });
  const violations: string[] = [];
  const events = run(sim, 24 * 7, (s) => {
    for (const v of checkInvariants(s.world)) violations.push(`${clock(s.t)} ${v.rule}: ${v.details}`);
  });

  it("never breaks an invariant (floor cover, standing spots, two-person care, RN reachable, checks, request waits)", () => {
    expect(violations.slice(0, 5)).toEqual([]);
    expect(ofType(events, "invariant.violated")).toEqual([]);
  });

  it("hands over three times a day, with the floor covered", () => {
    const done = ofType(events, "handover.completed");
    expect(done).toHaveLength(21);
    const tuesday = done.slice(0, 3).map((e) => [clock(e.t), e.payload.from, e.payload.to, e.payload.floorCover]);
    expect(tuesday).toEqual([
      ["07:15", ["stf_florin"], ["stf_blessing", "stf_maria"], "stf_tom"],
      ["14:20", ["stf_blessing"], ["stf_dave", "stf_aisha"], "stf_tom"],
      ["21:30", ["stf_dave"], ["stf_florin"], "stf_aisha"],
    ]);
    expect(done[0]!.payload.summary).toHaveLength(6);
    const briefings = ofType(events, "task.completed").filter((e) => e.payload.kind === "briefing");
    expect(briefings).toHaveLength(7); // after every 07:00 handover
  });

  it("gives every care worker one break, staggered so carers are never off together", () => {
    const tuesdayEnd = 108000 + 86400;
    const started = ofType(events, "break.started").filter((e) => e.t < tuesdayEnd);
    expect(started.map((e) => e.actors[0]).sort()).toEqual(["stf_aisha", "stf_blessing", "stf_dave", "stf_florin", "stf_joanne", "stf_maria", "stf_sanjay", "stf_tom", "stf_bev"].sort());
    const carers = new Set(["stf_aisha", "stf_blessing", "stf_dave", "stf_tom"]);
    const spans = ofType(events, "break.started")
      .filter((e) => carers.has(e.actors[0]!) && e.t < tuesdayEnd)
      .map((e) => ({ who: e.actors[0]!, from: e.t, to: ofType(events, "break.ended").find((x) => x.actors[0] === e.actors[0] && x.t > e.t)!.t }));
    for (const a of spans) for (const b of spans) if (a !== b) expect(a.to <= b.from || b.to <= a.from, `${a.who} and ${b.who}`).toBe(true);
    const florin = ofType(events, "break.started").find((e) => e.actors[0] === "stf_florin")!;
    expect(florin.payload.pointId).toBe("WaitingArea.Seat8"); // sole night carer stays in the wing
  });

  it("answers help requests, with two staff for Raj and only women for Peggy's personal care", () => {
    const requests = ofType(events, "resident.requested_help");
    expect(requests.length).toBeGreaterThan(30);
    const assigned = new Map(ofType(events, "task.assigned").map((e) => [e.payload.taskId, e.payload.staffIds]));
    const women = new Set(data.staff.filter((s) => s.gender === "female").map((s) => s.id));
    for (const r of requests) {
      const staff = assigned.get(r.payload.taskId);
      if (!staff) continue; // still waiting at the end of the week
      if (r.payload.residentId === "res_raj" && r.payload.need === "toileting") expect(staff).toHaveLength(2);
      if (r.payload.residentId === "res_peggy" && r.payload.need === "toileting") for (const s of staff) expect(women.has(s) || s.startsWith("agy_"), s).toBe(true);
    }
    const completed = ofType(events, "task.completed").filter((e) => e.payload.kind === "assist");
    expect(completed.length).toBeGreaterThan(requests.length * 0.9);
  });

  it("keeps staff on after their shift until they are relieved", () => {
    const tuesday = events.filter((e) => e.t < 108000 + 86400);
    const handovers = ofType(tuesday, "handover.completed");
    const left = (id: string, after: number) => ofType(tuesday, "person.departed").find((e) => e.actors[0] === id && e.t > after)!.t;
    expect(left("stf_florin", 108000)).toBeGreaterThanOrEqual(handovers[0]!.t);
    expect(left("stf_aisha", 108000)).toBeGreaterThanOrEqual(handovers[2]!.t);
  });
});

describe("throughput", () => {
  // A real slowdown should fail CI. Override with VCH_DAY_BUDGET_MS on slow machines.
  const budgetMs = Number(process.env.VCH_DAY_BUDGET_MS ?? 2000);

  it(`runs one sim day headless within ${budgetMs} ms`, () => {
    const sim = createSim({ seed: "1", data });
    const start = performance.now();
    for (let i = 0; i < 24 * HOUR; i++) sim.step();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(budgetMs);
  });
});

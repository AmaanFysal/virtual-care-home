// The behaviour-audit fixes (docs/05, docs/04): tea on waking, breakfast from 07:30, the nurse
// and the 08:00 round, left and owed drinks, requests met during care, and two-person tasks
// reserved rather than held in the corridor.

import { describe, expect, it } from "vitest";
import { TICK_SECONDS, timeOfDay, type AnySimEvent, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { createSim } from "../src/index.js";
import { DRINK_STALE_MINS } from "../src/needs.js";
import { isNurse } from "../src/state.js";
import { createAssist, createCare } from "../src/tasks.js";
import { markChecked } from "../src/trees.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const HOUR = 3600 / TICK_SECONDS;
const at = (h: number, m = 0) => (h * 60 + m) * 60;

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

describe("a week of mornings and drinks (seed 1)", () => {
  const sim = createSim({ seed: "1", data });
  const w = sim.world;
  const events: AnySimEvent[] = [];
  const nurseOnTwoPersonMorning: string[] = [];
  const heldInCorridor: string[] = [];
  const roundDone = new Set<number>();
  for (let i = 0; i < 7 * 24 * HOUR; i++) {
    const step = sim.step();
    events.push(...step);
    const day = Math.floor(w.t / 86400);
    for (const e of step) {
      if (e.type === "med_round.completed" && e.payload.round === "08:00") roundDone.add(day);
      if (e.type === "task.assigned") {
        const task = w.tasks.get(e.payload.taskId);
        const tod = timeOfDay(e.t);
        const nurse = e.payload.staffIds.some((id) => isNurse(w.people.get(id)!));
        if (task && nurse && tod >= at(7, 45) && tod < at(12) && !roundDone.has(day)) nurseOnTwoPersonMorning.push(`${e.t} ${task.label}`);
      }
    }
    for (const t of w.tasks.values()) {
      if ((t.kind === "care" || t.kind === "assist") && t.status === "open" && t.assigned.length > 0) heldInCorridor.push(`${w.t} ${t.label}`);
    }
  }
  const drinkers = data.residents.filter((r) => r.care.eating_support !== "mouth_care_only").map((r) => r.id);
  const days = [...new Set(ofType(events, "resident.woke").map((e) => Math.floor((e.t - at(4)) / 86400)))];

  it("gives tea on waking as its own visit, every morning, usually within 15 minutes", () => {
    const teas = ofType(events, "drink.served").filter((e) => e.payload.round === "waking");
    let onTime = 0;
    let mornings = 0;
    for (const id of drinkers) {
      const r = data.residents.find((x) => x.id === id)!;
      for (const d of days) {
        const wake = d * 86400 + at(4) + at(Number(r.routine.wake!.slice(0, 2)) - 4, Number(r.routine.wake!.slice(3)));
        if (wake + 3 * 3600 > sim.t) continue;
        mornings += 1;
        const tea = teas.find((e) => e.payload.residentId === id && e.t >= wake && e.t < wake + 4 * 3600);
        expect(tea, `${id} day ${d}`).toBeDefined();
        const first = ofType(events, "drink.served").find((e) => e.payload.residentId === id && e.payload.outcome === "drunk" && e.t >= wake);
        if (first && first.t - wake <= 15 * 60) onTime += 1;
      }
    }
    expect(onTime / mornings).toBeGreaterThanOrEqual(0.75);
  });

  it("serves breakfast from 07:30", () => {
    const breakfasts = ofType(events, "meal.served").filter((e) => e.payload.meal === "breakfast");
    for (const b of breakfasts) expect(timeOfDay(b.t)).toBeGreaterThanOrEqual(at(7, 30));
    expect(breakfasts.some((b) => timeOfDay(b.t) < at(8))).toBe(true);
  });

  it("keeps the nurse off all resident care from 07:45 until the 08:00 round is done", () => {
    expect(nurseOnTwoPersonMorning).toEqual([]);
  });

  it("gives time-critical medication first on every round (Arthur's Parkinson's)", () => {
    const rounds = ofType(events, "med_round.started");
    for (const r of rounds) {
      const first = ofType(events, "med.administered").find((e) => e.t >= r.t && e.payload.round === r.payload.round);
      if (first) expect(first.payload.residentId, `${r.payload.round} at ${r.t}`).toBe("res_arthur");
    }
  });

  it("never leaves a drink with someone who needs help to drink (Raj, Dennis)", () => {
    const left = ofType(events, "drink.served").filter((e) => e.payload.outcome === "left" && ["res_raj", "res_dennis"].includes(e.payload.residentId));
    expect(left).toEqual([]);
    expect(ofType(events, "drink.served").some((e) => e.payload.residentId === "res_raj" && e.payload.outcome === "owed")).toBe(true);
  });

  it("never holds a two-person task with one carer (it is reserved instead)", () => {
    expect(heldInCorridor.slice(0, 3)).toEqual([]);
  });
});

describe("left drinks", () => {
  it("go stale after 2 hours, are never drunk, and are replaced at the next contact", () => {
    const sim = createSim({ seed: "1", data });
    const w = sim.world;
    for (let i = 0; i < 6 * HOUR; i++) sim.step(); // Tue 12:00
    const win = w.people.get("res_win")!;
    win.resident!.drinkLeftT = w.t - (DRINK_STALE_MINS + 1) * 60;
    win.resident!.needs.thirst = 0.6;
    do sim.step(); // to the next minute update
    while (w.t % 60 !== 0);
    expect(win.resident!.drinkLeftT).toBeNull();
    expect(win.resident!.drinkStale).toBe(true);
    expect(win.resident!.needs.thirst).toBeGreaterThan(0.55); // not drunk
    const staff = [...w.people.values()].find((p) => p.staff?.duty === "on_shift" && p.onMap)!;
    markChecked(w, win, [staff], false);
    expect(win.resident!.drinkStale).toBe(false);
    expect(w.pending.some((e) => e.type === "drink.served" && e.payload.round === "top_up" && e.payload.outcome === "drunk")).toBe(true);
  });
});

describe("a request during care", () => {
  it("is met by the staff already giving that care (absorbed, not a second visit)", () => {
    const sim = createSim({ seed: "1", data });
    const w = sim.world;
    const raj = w.people.get("res_raj")!;
    const care = createCare(w, raj, "morning");
    const [a, b] = ["stf_florin", "stf_blessing"].map((id) => w.people.get(id)!);
    Object.assign(care, { status: "active", startedT: w.t, assigned: [a!.id, b!.id] });
    raj.resident!.busyTaskId = care.id;
    const request = createAssist(w, raj, "toileting");
    expect(request.data.absorbedBy).toBe(care.id);
    expect(care.data.absorbed).toBe(request.id);
  });
});

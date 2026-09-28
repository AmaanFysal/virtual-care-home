import { describe, expect, it } from "vitest";
import { TICK_SECONDS, timeOfDay, weekday, type AnySimEvent, type EventPayloads, type SimEvent } from "@vch/shared-types";
import { createSim, type Sim } from "../src/index.js";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const HOUR = 3600 / TICK_SECONDS;
const byId = new Map(data.visitors.map((v) => [v.id, v]));
const careStaff = new Set(data.staff.filter((s) => ["senior_carer", "care_assistant", "registered_nurse"].includes(s.role)).map((s) => s.id));

function run(sim: Sim, hours: number, each?: () => void): AnySimEvent[] {
  const out: AnySimEvent[] = [];
  for (let i = 0; i < hours * HOUR; i++) {
    out.push(...sim.step());
    each?.();
  }
  return out;
}

function ofType<K extends keyof EventPayloads>(events: AnySimEvent[], type: K): SimEvent<K>[] {
  return events.filter((e) => e.type === type) as unknown as SimEvent<K>[];
}

const hours = (t: number) => timeOfDay(t) / 3600;

describe("a week of visitors (seed 1)", () => {
  const sim = createSim({ seed: "1", data });
  const events = run(sim, 24 * 7);

  it("plans visits only on each visitor's listed days, within their arrival window", () => {
    const planned = ofType(events, "visit.planned");
    expect(planned.length).toBeGreaterThan(20);
    for (const e of planned) {
      const v = byId.get(e.payload.visitorId)!;
      expect(v.visit_pattern.days).toContain(weekday(e.payload.arriveT));
      if (!v.accompanies) {
        const [from, to] = v.visit_pattern.time_window.split("-").map((c) => Number(c.slice(0, 2)) + Number(c.slice(3)) / 60);
        expect(hours(e.payload.arriveT)).toBeGreaterThanOrEqual(from!);
        expect(hours(e.payload.arriveT)).toBeLessThanOrEqual(to!);
      }
    }
  });

  it("brings companions only with their lead, arriving together", () => {
    const planned = ofType(events, "visit.planned");
    for (const e of planned.filter((p) => byId.get(p.payload.visitorId)!.accompanies)) {
      const lead = planned.find((p) => p.payload.visitorId === byId.get(e.payload.visitorId)!.accompanies && p.payload.arriveT === e.payload.arriveT);
      expect(lead, e.payload.visitorId).toBeDefined();
    }
  });

  it("signs visitors in with Sanjay in office hours, and has a carer let them in otherwise", () => {
    const signedIn = ofType(events, "visitor.signed_in");
    expect(signedIn.length).toBeGreaterThan(20);
    const bells = new Set(ofType(events, "visitor.rang_bell").map((e) => e.t));
    expect(bells.size).toBeGreaterThan(0);
    for (const e of ofType(events, "visitor.let_in")) expect(careStaff.has(e.payload.staffId), e.payload.staffId).toBe(true);
    for (const e of signedIn) {
      if (e.payload.staffId === "stf_sanjay") {
        expect(["Sat", "Sun"]).not.toContain(weekday(e.t));
        expect(hours(e.t)).toBeGreaterThanOrEqual(8.5);
        expect(hours(e.t)).toBeLessThanOrEqual(16.5);
      }
    }
  });

  it("keeps protected lunch: only a visitor who helps at meals starts a visit from 12:15 to 13:30", () => {
    for (const e of ofType(events, "visit.started")) {
      const h = hours(e.t);
      if (h >= 12.25 && h < 13.5) {
        const v = byId.get(e.payload.visitorId)!;
        const helper = v.may_help_at_meals || (v.accompanies && byId.get(v.accompanies)!.may_help_at_meals);
        expect(helper, e.payload.visitorId).toBeTruthy();
      }
    }
  });

  it("ends every visit with signing out and leaving", () => {
    const started = ofType(events, "visit.started");
    const ended = ofType(events, "visit.ended");
    const out = ofType(events, "visitor.signed_out");
    expect(ended.length).toBeGreaterThanOrEqual(started.length - 2); // allow visits still going at the end
    for (const e of ended) {
      const signOut = out.find((o) => o.payload.visitorId === e.payload.visitorId && o.t >= e.t);
      expect(signOut, e.payload.visitorId).toBeDefined();
      const left = ofType(events, "person.departed").find((d) => d.actors[0] === e.payload.visitorId && d.t >= signOut!.t);
      expect(left, e.payload.visitorId).toBeDefined();
    }
  });

  it("lets Kuldip help Raj eat at lunch, so staff only bring the tray", () => {
    const kuldipDays = ofType(events, "visit.started").filter((e) => e.payload.visitorId === "vis_kuldip").map((e) => Math.floor(e.t / 86400));
    const lunches = ofType(events, "meal.served").filter((e) => e.payload.residentId === "res_raj" && e.payload.meal === "lunch" && kuldipDays.includes(Math.floor(e.t / 86400)));
    expect(lunches.length).toBeGreaterThan(0);
    for (const lunch of lunches) {
      const started = ofType(events, "task.started").filter((s) => s.t <= lunch.t && s.actors.includes("res_raj")).at(-1)!;
      expect(lunch.t - started.t).toBeLessThanOrEqual(3 * 60);
    }
  });
});

describe("visitors and hospital", () => {
  it("doesn't bring visitors for a resident who is in hospital", () => {
    const sim = createSim({ seed: "1", data });
    sim.enqueue({ seq: 1, applyTick: 12, type: "inject_fall", payload: { residentId: "res_raj", severity: "serious" }, source: "user" });
    const events = run(sim, 24 * 2);
    const conveyed = ofType(events, "resident.conveyed_to_hospital")[0]!;
    const after = ofType(events, "visit.started").filter((e) => e.payload.residentId === "res_raj" && e.t > conveyed.t);
    expect(after).toEqual([]);
  });
});

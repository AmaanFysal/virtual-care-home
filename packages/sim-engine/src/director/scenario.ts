// Scripted scenarios (docs/10): data/scenarios/*.json. Each event is applied exactly as written,
// at its time, as an input with source "director" (origin "scenario:<id>").

import {
  SECONDS_PER_DAY,
  WEEKDAYS,
  COVER_CHOICES,
  DISEASES,
  ILLNESS_KINDS,
  ROTA_SLOTS,
  WEEK_OFF_CAUSES,
  clockToSeconds,
  dayIndex,
  type InputPayloads,
  type InputType,
  type Scenario,
  type WorldData,
} from "@vch/shared-types";
import type { DirectorEvent } from "../state.js";

export const INPUT_TYPES: InputType[] = ["inject_fall", "staff_sick", "shift_no_show", "infection_case", "resident_illness", "end_of_life_start", "admission", "visitor_week_off", "celebration"];
const SLOTS: readonly string[] = ROTA_SLOTS;
const COVERS: readonly string[] = COVER_CHOICES;

/** Problems with an input's type and params (used for scenario files and the admin panel's `inject`). */
export function validateInput(type: string, params: unknown, data: WorldData): string[] {
  if (!INPUT_TYPES.includes(type as InputType)) return [`unknown event type "${type}"`];
  if (typeof params !== "object" || params === null) return [`${type}: params must be an object`];
  const p = params as Record<string, unknown>;
  const errors: string[] = [];
  const cover = () => {
    if (p.cover !== undefined && !COVERS.includes(String(p.cover))) errors.push(`${type}: cover must be one of ${COVERS.join(", ")}`);
  };
  if (type === "inject_fall") {
    if (!data.residents.some((r) => r.id === p.residentId)) errors.push(`inject_fall: unknown resident "${String(p.residentId)}"`);
    if (p.severity !== "minor" && p.severity !== "serious") errors.push("inject_fall: severity must be minor or serious");
  } else if (type === "staff_sick") {
    if (!data.staff.some((s) => s.id === p.staffId)) errors.push(`staff_sick: unknown staff member "${String(p.staffId)}"`);
    cover();
  } else if (type === "infection_case") {
    if (!data.residents.some((r) => r.id === p.personId) && !data.staff.some((x) => x.id === p.personId)) errors.push(`infection_case: unknown resident or staff member "${String(p.personId)}"`);
    if (!(DISEASES as readonly string[]).includes(String(p.disease))) errors.push(`infection_case: disease must be one of ${DISEASES.join(", ")}`);
  } else if (type === "resident_illness") {
    if (!data.residents.some((r) => r.id === p.residentId)) errors.push(`resident_illness: unknown resident "${String(p.residentId)}"`);
    if (!(ILLNESS_KINDS as readonly string[]).includes(String(p.kind))) errors.push(`resident_illness: kind must be one of ${ILLNESS_KINDS.join(", ")}`);
    if (p.severity !== "mild" && p.severity !== "severe") errors.push("resident_illness: severity must be mild or severe");
  } else if (type === "end_of_life_start") {
    if (!data.residents.some((r) => r.id === p.residentId)) errors.push(`end_of_life_start: unknown resident "${String(p.residentId)}"`);
    if (!Number.isInteger(p.expectedDays) || Number(p.expectedDays) < 1) errors.push("end_of_life_start: expectedDays must be a whole number of days, at least 1");
  } else if (type === "admission") {
    if (typeof p.cardId !== "string" || !p.cardId) errors.push("admission: cardId is required");
  } else if (type === "visitor_week_off") {
    if (!data.visitors.some((v) => v.id === p.visitorId)) errors.push(`visitor_week_off: unknown visitor "${String(p.visitorId)}"`);
    if (!(WEEK_OFF_CAUSES as readonly string[]).includes(String(p.cause))) errors.push(`visitor_week_off: cause must be one of ${WEEK_OFF_CAUSES.join(", ")}`);
  } else if (type === "celebration") {
    if (p.kind !== "birthday" && p.kind !== "festival") errors.push("celebration: kind must be birthday or festival");
    if (typeof p.name !== "string" || !p.name) errors.push("celebration: name is required");
    const ids = Array.isArray(p.residentIds) ? (p.residentIds as unknown[]) : [];
    if (ids.length === 0) errors.push("celebration: residentIds must list at least one resident");
    for (const id of ids) if (!data.residents.some((r) => r.id === id)) errors.push(`celebration: unknown resident "${String(id)}"`);
  } else if (type === "shift_no_show") {
    if (!SLOTS.includes(String(p.slot))) errors.push(`shift_no_show: slot must be one of ${SLOTS.join(", ")}`);
    cover();
  }
  return errors;
}

/** Problems with a scenario file. */
export function validateScenario(s: Scenario, data: WorldData): string[] {
  const errors: string[] = [];
  if (!s || typeof s !== "object") return ["scenario must be an object"];
  if (!/^[a-z0-9-]+$/.test(String(s.id))) errors.push("id must be lower-case words joined by hyphens");
  if (!s.name) errors.push("name is required");
  if (typeof s.random !== "boolean") errors.push("random must be true or false");
  if (!Array.isArray(s.events)) return [...errors, "events must be a list"];
  s.events.forEach((e, i) => {
    const at = `events[${i}]`;
    if (e.t !== undefined) {
      if (!Number.isInteger(e.t) || e.t % 60 !== 0) errors.push(`${at}: t must be whole minutes of sim time`);
      if (e.day !== undefined || e.time !== undefined) errors.push(`${at}: give either t, or day and time`);
    } else {
      if (!WEEKDAYS.includes(e.day!)) errors.push(`${at}: day must be one of ${WEEKDAYS.join(", ")}`);
      try {
        clockToSeconds(e.time ?? "");
      } catch {
        errors.push(`${at}: time must be HH:MM`);
      }
      if (e.week !== undefined && (!Number.isInteger(e.week) || e.week < 0)) errors.push(`${at}: week must be 0 or more`);
    }
    errors.push(...validateInput(e.type, e.params, data).map((m) => `${at}: ${m}`));
  });
  return errors;
}

/**
 * When each scripted event applies: `day` is the first such weekday on or after the run's start
 * (a time already past on the start day means the next week), plus `week` weeks.
 */
export function scenarioEvents(s: Scenario, startT: number): DirectorEvent[] {
  const startDay = dayIndex(startT);
  return s.events
    .map((e) => {
      let applyT = e.t;
      if (applyT === undefined) {
        const offset = (WEEKDAYS.indexOf(e.day!) - (startDay % 7) + 7) % 7;
        applyT = (startDay + offset + 7 * (e.week ?? 0)) * SECONDS_PER_DAY + clockToSeconds(e.time!);
        if (applyT <= startT) applyT += 7 * SECONDS_PER_DAY;
      }
      return { applyT, type: e.type, params: e.params as InputPayloads[InputType], origin: `scenario:${s.id}` };
    })
    .sort((a, b) => a.applyT - b.applyT);
}

// The activity export (docs/workstreams/activity-export/spec.md): a run's world description written
// as CSV rows for external models (the air model first, in its own repo). The rows are built here
// and handed to a `write` callback; scripts/export.ts puts them in files. Reads the world only, so
// exporting a run never changes it.

import { WORLD_SCHEMA, simDate, timeOfDay, type AnySimEvent, type ActivityTable, type Touch, type WeatherHour, type WorldDescription } from "@vch/shared-types";
import { intensityOf } from "./activity.js";
import { infectionStatus, isIsolated } from "./infection.js";
import type { Sim } from "./sim.js";
import type { World } from "./state.js";

/** Bumped whenever a column, file or manifest field changes. */
export const EXPORT_SCHEMA = 1;

/** The CSV files and their columns, in order. */
export const STREAMS = {
  people: ["t", "time", "personId", "kind", "roomId", "x", "y", "activity", "met", "intensity", "book", "code", "infection", "infectionStatus", "infectious", "isolated"],
  doors: ["t", "time", "doorId", "state", "heldBy"],
  windows: ["t", "time", "windowId", "roomId", "state", "openingMm"],
  equipment: ["t", "time", "equipmentId", "kind", "roomId", "on", "level", "setpointC"],
  touches: ["t", "time", "personId", "objectId", "roomId"],
  weather: ["t", "time", "dataTime", "tempC", "humidityPct", "dewPointC", "precipMm", "cloudPct", "windMps", "windDirDeg", "shortwaveWm2", "pressureHpa", "isDay"],
  events: ["t", "time", "seq", "type", "source", "actors", "payload"],
  activities: ["group", "activity", "book", "code", "met", "intensity", "description", "aid", "belowMps", "inBed"],
} as const;

export type StreamName = keyof typeof STREAMS;
type Cell = string | number | boolean | null | undefined;

/** One CSV line (no newline). Quoted only when it has to be: a comma, quote or line break. */
export function csvLine(cells: readonly Cell[]): string {
  return cells
    .map((c) => {
      const s = c === null || c === undefined ? "" : String(c);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

/** The sim's clock as "2026-12-01T06:00:00" (no time zone, no daylight saving). */
export function isoTime(t: number): string {
  const { year, month, day } = simDate(t);
  const secs = timeOfDay(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
}

/** Rows for a sample: everyone on the map, every door, window and item of equipment. */
export function sampleRows(world: World, d: WorldDescription): { people: Cell[][]; doors: Cell[][]; windows: Cell[][]; equipment: Cell[][] } {
  const at = [d.t, isoTime(d.t)];
  return {
    people: d.people.map((p) => {
      const person = world.people.get(p.personId)!;
      const inf = person.infection;
      const status = infectionStatus(person, d.t);
      const infectious = !!inf && d.t >= inf.infectiousFromT && d.t < inf.infectiousUntilT;
      return [...at, p.personId, p.kind, p.roomId, p.x, p.y, p.activity, p.met, p.intensity, p.book, p.code, status ? inf!.disease : null, status, infectious, isIsolated(person)];
    }),
    doors: d.doors.map((x) => [...at, x.doorId, x.state, x.heldBy]),
    windows: d.windows.map((x) => [...at, x.windowId, x.roomId, x.state, x.openingMm]),
    equipment: d.equipment.map((x) => [...at, x.equipmentId, x.kind, x.roomId, x.on, x.level, x.setpointC]),
  };
}

export function touchRow(world: World, touch: Touch): Cell[] {
  return [touch.t, isoTime(touch.t), touch.personId, touch.objectId, world.people.get(touch.personId)?.roomId];
}

export function weatherRow(t: number, w: WeatherHour): Cell[] {
  return [t, isoTime(t), w.time, w.tempC, w.humidityPct, w.dewPointC, w.precipMm, w.cloudPct, w.windMps, w.windDirDeg, w.shortwaveWm2, w.pressureHpa, w.isDay];
}

export function eventRow(e: AnySimEvent): Cell[] {
  return [e.t, isoTime(e.t), e.seq, e.type, e.source, e.actors.join(";"), JSON.stringify(e.payload)];
}

/** Every Compendium entry in data/activities.json, residents' first. */
export function activityRows(table: ActivityTable): Cell[][] {
  const rows: Cell[][] = [];
  for (const group of ["resident", "other"] as const)
    for (const [activity, entries] of Object.entries(table[group]))
      for (const e of entries) rows.push([group, activity, e.book, e.code, e.met, intensityOf(e.met), e.description, e.aid, e.below_mps, e.in_bed]);
  return rows;
}

/** The building's geometry, with the same ids as the CSVs, and everything people can touch. */
export function roomsJson(world: World) {
  const fp = world.data.floorplan;
  const contains = (a: (typeof fp.rooms)[number], b: (typeof fp.rooms)[number]) =>
    a !== b && b.rect.x >= a.rect.x && b.rect.y >= a.rect.y && b.rect.x + b.rect.w <= a.rect.x + a.rect.w && b.rect.y + b.rect.h <= a.rect.y + a.rect.h;
  const width = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.round(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 1000) / 1000;
  return {
    units: { length: "m", area: "m2", opening: "mm" },
    size: fp.size,
    rooms: fp.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      rect: r.rect,
      floorAreaM2: r.floor_area_m2,
      ceilingHeightM: r.ceiling_height_m,
      inside: fp.rooms.find((a) => contains(a, r))?.id ?? null,
    })),
    doors: fp.doors.map((d) => ({ id: d.id, rooms: d.rooms, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, widthM: d.clear_width_m ?? width(d) })),
    windows: fp.windows.map((w) => ({ id: w.id, room: w.room, wall: w.wall, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, widthM: width(w), maxOpeningMm: world.data.building.windows.max_opening_mm })),
    equipment: fp.equipment.map((e) => ({ id: e.id, kind: e.kind, room: e.room, x: e.x, y: e.y })),
    objects: [...world.building!.objects.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((o) => ({ id: o.id, room: o.roomId, at: o.at })),
  };
}

export interface ExportOptions {
  /** Where the run stops (exclusive), in sim seconds. */
  endT: number;
  /** The sampling interval: a whole number of ticks (5 s). */
  everySeconds: number;
}

/**
 * Runs `sim` from where it is to `endT`, handing each stream's lines (header first) to `write`.
 * Samples every `everySeconds` from the start, weather every hour, and every touch and event as it
 * happens. Returns the number of rows written to each stream (headers not counted).
 */
export function exportRun(sim: Sim, options: ExportOptions, write: (stream: StreamName, line: string) => void): Record<StreamName, number> {
  const { endT, everySeconds } = options;
  if (everySeconds <= 0 || everySeconds % 5 !== 0) throw new Error(`The sampling interval must be a whole number of 5 s ticks, not ${everySeconds} s`);
  const world = sim.world;
  const startT = sim.t;
  const rows = Object.fromEntries(Object.keys(STREAMS).map((k) => [k, 0])) as Record<StreamName, number>;
  const put = (stream: StreamName, cells: Cell[]) => {
    write(stream, csvLine(cells));
    rows[stream] += 1;
  };
  for (const [stream, columns] of Object.entries(STREAMS)) write(stream as StreamName, csvLine(columns));
  for (const row of activityRows(world.data.activities)) put("activities", row);

  while (sim.t < endT) {
    const sampling = (sim.t - startT) % everySeconds === 0;
    const onTheHour = sim.t % 3600 === 0;
    if (sampling || onTheHour) {
      const d = sim.describe();
      if (sampling) {
        const sample = sampleRows(world, d);
        for (const stream of ["people", "doors", "windows", "equipment"] as const) for (const row of sample[stream]) put(stream, row);
      }
      if (onTheHour && d.weather) put("weather", weatherRow(sim.t, d.weather));
    }
    for (const e of sim.step()) put("events", eventRow(e));
    for (const touch of world.building!.touches) put("touches", touchRow(world, touch));
  }
  return rows;
}

export interface ManifestInput {
  seed: string;
  start: string;
  startT: number;
  endT: number;
  everySeconds: number;
  gzip: boolean;
  director: { mode: string; scenario: string | null; deaths: boolean };
  dataVersion: string;
  weather: { place: string; source: string; licence: string; from: string; to: string } | null;
  files: Record<string, { rows: number; columns: readonly string[] }>;
  command: string;
}

/** What the run was. No wall-clock time, so the same command writes the same manifest. */
export function manifestJson(m: ManifestInput) {
  return {
    exportSchema: EXPORT_SCHEMA,
    worldSchema: WORLD_SCHEMA,
    seed: m.seed,
    start: m.start,
    startT: m.startT,
    endT: m.endT,
    startTime: isoTime(m.startT),
    endTime: isoTime(m.endT),
    days: Math.round(((m.endT - m.startT) / 86400) * 1000) / 1000,
    sampleSeconds: m.everySeconds,
    gzip: m.gzip,
    director: m.director,
    dataVersion: m.dataVersion,
    weather: m.weather,
    time: "t is sim seconds since Mon 2026-11-02 00:00; time is the sim's clock (no time zone, no daylight saving); weather dataTime is the source hour (GMT)",
    files: m.files,
    command: m.command,
  };
}

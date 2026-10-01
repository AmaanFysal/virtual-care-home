// Equipment in use (v1.0-testbed PR 2): lights, heating, the Lounge TV, the staff-room kettle, WCs,
// basins and showers. Part of the building observer (building.ts): it follows what people already
// do and changes nothing they do. The engine says what's on; heat, light and energy are for
// external models (constitution rule 4, ADR-0006).

import { SECONDS_PER_DAY, clockToSeconds, dayIndex, simDate, type AnySimEvent, type RoomKind } from "@vch/shared-types";
import { emit } from "./emit.js";
import type { BuildingState, Person, World } from "./state.js";
import { touch } from "./touches.js";
import { weatherAt } from "./weather.js";

type Level = "dim" | "full";

/** What the rules look up every tick, worked out once per run (the observer runs every tick). */
interface Fixed {
  kind: Map<string, RoomKind>;
  windowed: Set<string>;
  corridorDim: [number, number];
  /** Equipment ids by kind. */
  ids: Record<"light" | "tv" | "kettle" | "heating", string[]>;
  /** Lights, the TV and kettles: checked every tick. */
  switched: string[];
  /** The heating season for the day it was last worked out. */
  season: { day: number; on: boolean };
}
const fixedFor = new WeakMap<World, Fixed>();

function fixed(world: World): Fixed {
  let f = fixedFor.get(world);
  if (!f) {
    const [a, b] = world.data.building.lights.corridor_dim;
    f = {
      kind: new Map(world.data.floorplan.rooms.map((r) => [r.id, r.kind])),
      windowed: new Set(world.data.floorplan.windows.map((w) => w.room)),
      corridorDim: [clockToSeconds(a), clockToSeconds(b)],
      ids: { light: [], tv: [], kettle: [], heating: [] },
      switched: [],
      season: { day: -1, on: false },
    };
    for (const e of world.data.floorplan.equipment) if (e.kind in f.ids) f.ids[e.kind as keyof Fixed["ids"]].push(e.id);
    f.switched = [...f.ids.light, ...f.ids.tv, ...f.ids.kettle];
    fixedFor.set(world, f);
  }
  return f;
}

function inWindow(tod: number, [a, b]: [number, number]): boolean {
  return a <= b ? tod >= a && tod < b : tod >= a || tod < b;
}

/** Inside the heating season (inclusive "MM-DD" dates, which may wrap round the new year), worked out once a day. */
function heatingSeason(world: World, t: number): boolean {
  const f = fixed(world);
  if (f.season.day === dayIndex(t)) return f.season.on;
  const { month, day } = simDate(t);
  const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const [from, to] = world.data.building.heating.season;
  f.season = { day: dayIndex(t), on: from <= to ? md >= from && md <= to : md >= from || md <= to };
  return f.season.on;
}

function roomKind(world: World, roomId: string): RoomKind {
  return fixed(world).kind.get(roomId)!;
}

export function initEquipment(world: World, building: BuildingState): void {
  const season = heatingSeason(world, world.t);
  for (const e of world.data.floorplan.equipment) {
    const heating = e.kind === "heating";
    const setpointC = heating ? world.data.building.heating.setpoint_c[roomKind(world, e.room)] : undefined;
    building.equipment.set(e.id, { kind: e.kind, roomId: e.room, on: heating && season, ...(setpointC !== undefined ? { setpointC } : {}) });
  }
}

/** Is it dark enough outside for the lights (or no weather to say)? */
function dark(world: World): boolean {
  const w = world.data.weather ? weatherAt(world.data.weather, world.t) : null;
  return !w || !w.isDay || w.shortwaveWm2 < world.data.building.lights.dark_below_wm2;
}

/** Who is in each room this tick (in id order). */
function occupants(world: World): Map<string, Person[]> {
  const out = new Map<string, Person[]>();
  for (const id of world.order) {
    const p = world.people.get(id)!;
    if (!p.onMap || !p.roomId) continue;
    const list = out.get(p.roomId);
    if (list) list.push(p);
    else out.set(p.roomId, [p]);
  }
  return out;
}

/** The level a room's light should be at now, and who is there to switch it. */
function lightLevel(world: World, f: Fixed, roomId: string, here: Person[], personalCare: Set<string>, isDark: boolean): { level: Level | null; by: Person | null } {
  const kind = f.kind.get(roomId)!;
  const tod = world.t % SECONDS_PER_DAY;
  if (kind === "corridor") return { level: inWindow(tod, f.corridorDim) ? "dim" : "full", by: null };
  if (kind === "reception") return { level: "full", by: null };
  const staff = here.find((p) => !!p.staff);
  const awake = here.filter((p) => !p.resident?.asleep);
  // No window, or dark outside: the light goes on for anyone awake there.
  const needsLight = isDark || !f.windowed.has(roomId);
  if (kind === "ensuite") return { level: here.length > 0 ? "full" : null, by: here[0] ?? null };
  if (kind === "bedroom") {
    const resident = here.find((p) => !!p.resident);
    if (staff && resident && personalCare.has(resident.id)) return { level: needsLight ? "full" : null, by: staff };
    // A night check while they sleep: a dimmed light (or none by day).
    if (staff && resident?.resident?.asleep) return { level: needsLight ? "dim" : null, by: staff };
    return { level: needsLight && awake.length > 0 ? "full" : null, by: staff ?? awake[0] ?? null };
  }
  return { level: needsLight && awake.length > 0 ? "full" : null, by: staff ?? awake[0] ?? null };
}

function switchOn(world: World, id: string, by: string | null, reason: string, level?: Level): void {
  const e = world.building!.equipment.get(id)!;
  if (e.on && e.level === level) return;
  e.on = true;
  if (level) e.level = level;
  else delete e.level;
  emit(world, "equipment.turned_on", by ? [by] : [], { equipmentId: id, kind: e.kind, roomId: e.roomId, byId: by, ...(level ? { level } : {}), reason });
}

function switchOff(world: World, id: string, by: string | null, reason: string): void {
  const e = world.building!.equipment.get(id)!;
  if (!e.on) return;
  e.on = false;
  delete e.level;
  emit(world, "equipment.turned_off", by ? [by] : [], { equipmentId: id, kind: e.kind, roomId: e.roomId, byId: by, reason });
}

/** Equipment rules, once a tick. `personalCare`: residents having private care at the bedside now. */
export function equipmentRules(world: World, events: AnySimEvent[], personalCare: Set<string>): void {
  const building = world.building!;
  const here = occupants(world);
  const isDark = dark(world);
  const f = fixed(world);
  const ids = f.ids;

  for (const id of f.switched) {
    const e = building.equipment.get(id)!;
    if (e.kind === "light") {
      const people = here.get(e.roomId) ?? [];
      const { level, by } = lightLevel(world, f, e.roomId, people, personalCare, isDark);
      const kind = f.kind.get(e.roomId);
      const fixed = kind === "corridor" || kind === "reception";
      if (level && (!e.on || e.level !== level)) {
        switchOn(world, id, by?.id ?? null, fixed ? (level === "dim" ? "night lights" : "day lights") : level === "dim" ? "night check" : "in use", level);
        if (by && !fixed) touch(world, by.id, `${e.roomId}.light_switch`);
      } else if (!level && e.on) {
        // Switched off by whoever is still there (someone settling for the night), or as the last one left.
        const stayer = people.find((p) => !!p.staff) ?? people.find((p) => !p.resident?.asleep);
        switchOff(world, id, stayer?.id ?? null, people.length === 0 ? "room empty" : isDark ? "asleep" : "daylight");
        if (stayer) touch(world, stayer.id, `${e.roomId}.light_switch`);
      }
    }
    if (e.kind === "tv") {
      const watchers = (here.get(e.roomId) ?? []).filter((p) => p.resident?.loungeActivity === "tv" && !p.resident.asleep);
      const staff = (here.get(e.roomId) ?? []).find((p) => !!p.staff);
      const by = staff ?? watchers[0] ?? null;
      if (watchers.length > 0 && !e.on) {
        switchOn(world, id, by?.id ?? null, "someone watching");
        if (by) touch(world, by.id, "Lounge.tv.remote");
      } else if (watchers.length === 0 && e.on) {
        switchOff(world, id, by?.id ?? null, "nobody watching");
        if (by) touch(world, by.id, "Lounge.tv.remote");
      }
    }
    if (e.kind === "kettle" && e.on && e.offAtT !== undefined && world.t >= e.offAtT) switchOff(world, id, null, "boiled");
  }

  // Heating: on with its set point for the season, off after it (all radiators switch together).
  const season = heatingSeason(world, world.t);
  if (ids.heating.length > 0 && building.equipment.get(ids.heating[0]!)!.on !== season)
  for (const id of ids.heating) {
    const e = building.equipment.get(id)!;
    if (e.on === season) continue;
    if (season) {
      switchOn(world, id, null, "heating season");
      emit(world, "heating.set_point_changed", [], { equipmentId: id, roomId: e.roomId, setpointC: e.setpointC!, reason: "heating season" });
    } else switchOff(world, id, null, "end of the heating season");
  }

  for (const ev of events) {
    // The kettle on for a break's tea in the staff room.
    if (ev.type === "break.started" && world.points.get(ev.payload.pointId)?.room === "StaffRoom") {
      for (const id of ids.kettle) {
        const e = building.equipment.get(id)!;
        e.offAtT = Math.max(e.offAtT ?? 0, world.t + world.data.building.kettle_mins * 60);
        switchOn(world, id, ev.payload.staffId, "tea on a break");
        touch(world, ev.payload.staffId, id);
      }
    }
  }
}

/** A WC flushed and hands washed at the basin, at the end of a visit (an instant use), from where they were (`at`). */
export function usedToilet(world: World, resident: Person, by: string, at: { x: number; y: number }): void {
  const ensuite = world.points.get(resident.resident!.data.room.replace(/\.Bed$/, ".WC"))?.room;
  if (!ensuite) return;
  for (const kind of ["wc", "basin"] as const) {
    const id = `${ensuite}.${kind}`;
    if (!world.building!.equipment.has(id)) continue;
    emit(world, "equipment.used", [by], { equipmentId: id, kind, roomId: ensuite, byId: by });
    touch(world, by, id, at);
  }
}

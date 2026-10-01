// The building (v1.0-testbed): doors and windows, their states and the rules that change them.
// An observer: it runs last in each tick, reads the world and the tick's events, and writes only
// `world.building`. Nothing else reads that, and it draws no random numbers, so it can never change
// what people do (spec decision 2). Set-state changes are logged; passing through a closed door
// is only in the world description.

import { SECONDS_PER_DAY, clockToSeconds, type AnySimEvent, type BuildingSettings, type DoorState, type WindowState } from "@vch/shared-types";
import { emit } from "./emit.js";
import type { BuildingState, DoorRule, Person, World } from "./state.js";
import { raining, weatherAt } from "./weather.js";

type SetState = DoorState["state"];

/** Care at the bedside that needs the door shut: washing, dressing, changing, turning, help with the toilet. */
const PRIVATE_CARE = new Set(["morning", "bedtime", "pad_change", "reposition", "comfort"]);

function roomOfPoint(world: World, pointId: string): string {
  return world.points.get(pointId)!.room;
}

function inWindow(tod: number, [from, until]: [string, string]): boolean {
  const a = clockToSeconds(from);
  const b = clockToSeconds(until);
  return a <= b ? tod >= a && tod < b : tod >= a || tod < b;
}

/** How each door's set state is decided, from the rooms it joins and data/building.json. */
function doorRule(world: World, rooms: [string, string], id: string, settings: BuildingSettings): DoorRule {
  const kind = (r: string) => world.data.floorplan.rooms.find((x) => x.id === r)?.kind;
  if (rooms.some((r) => kind(r) === "ensuite")) return { kind: "ensuite", roomId: rooms.find((r) => kind(r) === "ensuite")! };
  if (rooms.some((r) => kind(r) === "bedroom") && rooms.includes("Corridor")) return { kind: "bedroom", roomId: rooms.find((r) => kind(r) === "bedroom")! };
  if (settings.doors.locked.includes(id)) return { kind: "locked" };
  if (settings.doors.closed.includes(id)) return { kind: "closed" };
  return { kind: "held_open" };
}

export function initBuilding(world: World): BuildingState {
  const settings = world.data.building;
  const building: BuildingState = { doors: new Map(), windows: new Map(), night: new Set(), hoisted: new Set(), openedToday: new Map() };
  for (const d of world.data.floorplan.doors) building.doors.set(d.id, { rule: doorRule(world, d.rooms, d.id, settings), state: "open", rooms: d.rooms });
  for (const w of world.data.floorplan.windows) building.windows.set(w.id, { roomId: w.room, open: false, openedT: null });
  // The run starts with everyone asleep in bed: their night has begun.
  for (const id of world.order) {
    const p = world.people.get(id)!;
    if (p.resident && p.onMap && p.resident.inBed && p.resident.asleep) building.night.add(id);
  }
  world.building = building;
  const s = scan(world);
  for (const [id, door] of building.doors) door.state = doorSetState(world, id, s).state;
  return building;
}

/** What the rules need from the world this tick, gathered in one pass (the observer runs every tick). */
interface Scan {
  /** Each bedroom's resident, if they're on the wing. */
  residentIn: Map<string, Person>;
  /** The first person (in id order) in each room. */
  someoneIn: Map<string, string>;
  /** The first member of staff in each room. */
  staffIn: Map<string, Person>;
  /** Private care under way for each resident, with staff at their side. */
  care: Map<string, { staffId: string | null; label: string }>;
  /** The day-room doors' overnight hours. */
  overnight: boolean;
}

function scan(world: World): Scan {
  const out: Scan = { residentIn: new Map(), someoneIn: new Map(), staffIn: new Map(), care: new Map(), overnight: inWindow(world.t % SECONDS_PER_DAY, world.data.building.doors.closed_overnight) };
  for (const id of world.order) {
    const p = world.people.get(id)!;
    if (!p.onMap) continue;
    if (p.resident) out.residentIn.set(roomOfPoint(world, p.resident.data.room), p);
    if (p.roomId && !out.someoneIn.has(p.roomId)) out.someoneIn.set(p.roomId, p.id);
    if (p.staff && p.roomId && !out.staffIn.has(p.roomId)) out.staffIn.set(p.roomId, p);
  }
  for (const t of world.tasks.values()) {
    if (!t.residentId || t.status !== "active" || out.care.has(t.residentId)) continue;
    const care = String(t.data.care ?? "");
    // The care itself, and settling them afterwards (into bed, or up to their chair).
    const step = t.bt.node === "care" || t.bt.node === "settle the resident";
    const atBedside = step && ((t.kind === "care" && PRIVATE_CARE.has(care)) || (t.kind === "assist" && t.need === "toileting"));
    const atWc = t.kind === "assist" && t.bt.node === "at the WC";
    if (atBedside || atWc) out.care.set(t.residentId, { staffId: t.assigned[0] ?? null, label: t.label });
  }
  return out;
}

/** A resident with no bedtime on their card (Dennis) has the building's night. */
function inNight(world: World, p: Person, s: Scan): boolean {
  return world.building!.night.has(p.id) || (!p.resident!.data.routine.bed && s.overnight);
}

function doorSetState(world: World, doorId: string, s: Scan): { state: SetState; byId: string | null; reason: string } {
  const rule = world.building!.doors.get(doorId)!.rule;
  switch (rule.kind) {
    case "locked":
      return { state: "locked", byId: null, reason: "keypad" };
    case "closed":
      return { state: "closed", byId: null, reason: "kept closed" };
    case "held_open":
      return s.overnight ? { state: "closed", byId: null, reason: "fire door closed overnight" } : { state: "open", byId: null, reason: "held open by day" };
    case "ensuite": {
      const inside = s.someoneIn.get(rule.roomId);
      return inside ? { state: "closed", byId: inside, reason: "in use" } : { state: "ajar", byId: null, reason: "not in use" };
    }
    case "bedroom": {
      const r = s.residentIn.get(rule.roomId);
      if (!r) return { state: "closed", byId: null, reason: "room empty" };
      const care = s.care.get(r.id);
      if (care) return { state: "closed", byId: care.staffId, reason: `personal care (${care.label})` };
      if (inNight(world, r, s)) {
        const pref = r.resident!.data.care.door_at_night ?? "closed";
        return { state: pref, byId: null, reason: pref === "closed" ? "night" : `night: ${r.resident!.data.care.door_at_night_reason ?? "their card"}` };
      }
      return { state: "open", byId: null, reason: "day" };
    }
  }
}

const DOOR_EVENT = { open: "door.opened", ajar: "door.set_ajar", closed: "door.closed", locked: "door.locked" } as const;

function windowAllowed(world: World): boolean {
  const w = world.data.weather ? weatherAt(world.data.weather, world.t) : null;
  const s = world.data.building.windows;
  if (!w || !w.isDay || raining(w)) return false;
  if (w.tempC < s.open_min_temp_c || w.windMps >= s.open_max_wind_mps) return false;
  return world.t % SECONDS_PER_DAY < clockToSeconds(s.close_by);
}

function setWindow(world: World, windowId: string, open: boolean, byId: string | null, reason: string): void {
  const w = world.building!.windows.get(windowId)!;
  if (w.open === open) return;
  w.open = open;
  w.openedT = open ? world.t : null;
  if (open) world.building!.openedToday.set(windowId, Math.floor(world.t / SECONDS_PER_DAY));
  emit(world, open ? "window.opened" : "window.closed", byId ? [byId] : [], { windowId, roomId: w.roomId, byId, reason });
}

function windowsIn(world: World, roomId: string): string[] {
  return [...world.building!.windows].filter(([, w]) => w.roomId === roomId).map(([id]) => id);
}


function openedToday(world: World, windowId: string): boolean {
  return world.building!.openedToday.get(windowId) === Math.floor(world.t / SECONDS_PER_DAY);
}

function windowRules(world: World, events: AnySimEvent[], scanned: Scan): void {
  const s = world.data.building.windows;
  const tod = world.t % SECONDS_PER_DAY;
  for (const e of events) {
    // Aired after morning care, if the weather allows; shut at bedtime.
    if (e.type === "care.personal_care_done") {
      const roomId = roomOfPoint(world, world.people.get(e.payload.residentId)!.resident!.data.room);
      for (const id of windowsIn(world, roomId)) {
        if (e.payload.period === "morning" && windowAllowed(world) && !openedToday(world, id)) setWindow(world, id, true, e.payload.staffIds[0] ?? null, "aired after morning care");
        if (e.payload.period === "evening") setWindow(world, id, false, e.payload.staffIds[0] ?? null, "bedtime");
      }
    }
    // The Lounge: one window opened by the first member of staff in after the morning.
    if (e.type === "person.entered_room" && e.payload.roomId === "Lounge" && tod >= clockToSeconds(s.lounge_from)) {
      const p = world.people.get(e.actors[0]!)!;
      const first = windowsIn(world, "Lounge")[0];
      if (p.staff && first && windowAllowed(world) && !openedToday(world, first)) setWindow(world, first, true, p.id, "aired by day");
    }
  }
  // Closed by a member of staff in the room once it's been open long enough or the weather turns,
  // and any still open at the end of the day on the evening round.
  const w = world.data.weather ? weatherAt(world.data.weather, world.t) : null;
  const turned = !w || raining(w) || w.tempC < s.open_min_temp_c || w.windMps >= s.open_max_wind_mps;
  for (const [id, win] of world.building!.windows) {
    if (!win.open) continue;
    if (tod >= clockToSeconds(s.close_by)) {
      setWindow(world, id, false, null, "closed on the evening round");
      continue;
    }
    const due = world.t - win.openedT! >= s.close_after_mins * 60;
    const staff = due || turned ? scanned.staffIn.get(win.roomId) : undefined;
    if (staff) setWindow(world, id, false, staff.id, turned ? "weather" : "aired long enough");
  }
}

/** Runs last in each tick: updates the building from the world and this tick's events. */
export function observeBuilding(world: World): void {
  const building = world.building;
  if (!building) return;
  const events = world.pending;
  building.hoisted.clear();
  for (const e of events) {
    if (e.type === "resident.went_to_bed") building.night.add(e.payload.residentId);
    if (e.type === "resident.woke" && e.payload.reason === "routine") building.night.delete(e.payload.residentId);
    if (e.type === "resident.transferred" && e.payload.method === "hoist") building.hoisted.add(e.payload.residentId);
  }
  const s = scan(world);
  for (const [id, door] of building.doors) {
    const next = doorSetState(world, id, s);
    if (next.state === door.state) continue;
    door.state = next.state;
    emit(world, DOOR_EVENT[next.state], next.byId ? [next.byId] : [], { doorId: id, byId: next.byId, reason: next.reason });
  }
  windowRules(world, events, s);
}

/** Doors as the description shows them: a closed, ajar or locked door is open while someone is in its doorway. */
export function doorStates(world: World): DoorState[] {
  return [...world.building!.doors].map(([doorId, d]) => {
    const holder = world.zoneOwner.get(doorId) ?? null;
    const passing = holder !== null && d.state !== "open";
    return { doorId, rooms: d.rooms, state: passing ? "open" : d.state, heldBy: passing ? holder : null };
  });
}

export function windowStates(world: World): WindowState[] {
  const mm = world.data.building.windows.max_opening_mm;
  return [...world.building!.windows].map(([windowId, w]) => ({ windowId, roomId: w.roomId, state: w.open ? "open" : "closed", openingMm: w.open ? mm : 0 }));
}

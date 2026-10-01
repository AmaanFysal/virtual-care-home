// Touches (v1.0-testbed PR 2): whose hand was on what, and when, for surface models. Part of the
// building observer (building.ts), so it changes nothing people do. A touch is recorded only when
// the person is within reach of the object (1.5 m): the engine doesn't walk anyone to a window or
// a kettle (spec decision 2), and a touch at a distance would be false data.

import type { AnySimEvent, Touch } from "@vch/shared-types";
import { usedToilet } from "./equipment.js";
import type { BuildingState, Person, TouchObject, World } from "./state.js";

export const REACH_M = 1.5;
const RECENT = 20;

/** Bedside care that has hands on the bed (rails, sheets): washing, dressing, changing, turning, comfort. */
const AT_THE_BED = new Set(["morning", "bedtime", "pad_change", "reposition", "comfort"]);

/** Everything people can touch: furniture, door handles and the keypad, light switches, windows, equipment, and residents' own things. */
export function touchObjects(world: World): Map<string, TouchObject> {
  const fp = world.data.floorplan;
  const objects = new Map<string, TouchObject>();
  const add = (o: TouchObject) => objects.set(o.id, o);
  for (const f of fp.furniture) add({ id: f.id, roomId: f.room, at: { kind: "rect", ...f.rect } });
  for (const d of fp.doors) {
    const x = (d.x1 + d.x2) / 2, y = (d.y1 + d.y2) / 2;
    add({ id: d.rooms.includes("Outside") ? `${d.id}.keypad` : `${d.id}.handle`, roomId: null, at: { kind: "point", x, y } });
  }
  for (const w of fp.windows) add({ id: w.id, roomId: w.room, at: { kind: "point", x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 } });
  for (const e of fp.equipment) add({ id: e.id, roomId: e.room, at: { kind: "point", x: e.x, y: e.y } });
  // A light switch just inside each room's way in (its door from the corridor, or into the en-suite).
  for (const r of fp.rooms) {
    const door = fp.doors.find((d) => d.rooms.includes(r.id) && (r.kind === "ensuite" || d.rooms.includes("Corridor") || r.kind === "corridor")) ?? fp.doors.find((d) => d.rooms.includes(r.id));
    if (!door) continue;
    const x = (door.x1 + door.x2) / 2, y = (door.y1 + door.y2) / 2;
    const cx = r.rect.x + r.rect.w / 2, cy = r.rect.y + r.rect.h / 2;
    // 0.3 m into the room from the doorway.
    const into = door.y1 === door.y2 ? { x, y: y + (cy > y ? 0.3 : -0.3) } : { x: x + (cx > x ? 0.3 : -0.3), y };
    add({ id: `${r.id}.light_switch`, roomId: r.id, at: { kind: "point", ...into } });
  }
  add({ id: "Lounge.tv.remote", roomId: "Lounge", at: { kind: "carried" } });
  add({ id: "med_trolley", roomId: null, at: { kind: "carried" } });
  const desk = world.points.get("Reception.Desk");
  if (desk) add({ id: "Reception.visitors_book", roomId: "Reception", at: { kind: "point", x: desk.x, y: desk.y } });
  for (const id of world.order) residentObjects(world, world.people.get(id)!, objects);
  return objects;
}

/** A resident's own things: cup, tray, call bell, walking aid or wheelchair, and a hoist kept in their room. */
function residentObjects(world: World, p: Person, objects: Map<string, TouchObject>): void {
  const r = p.resident?.data;
  if (!r) return;
  const roomId = world.points.get(r.room)!.room;
  const withThem = { kind: "with" as const, personId: p.id };
  for (const thing of ["cup", "tray", "call_bell"]) objects.set(`${p.id}.${thing}`, { id: `${p.id}.${thing}`, roomId: null, at: withThem });
  const aid = r.mobility.aid;
  if (/zimmer|rollator|stick/.test(aid)) objects.set(`${p.id}.walking_aid`, { id: `${p.id}.walking_aid`, roomId: null, at: withThem });
  if (/wheelchair/.test(aid)) objects.set(`${p.id}.wheelchair`, { id: `${p.id}.wheelchair`, roomId: null, at: withThem });
  if (r.care.transfer_method === "hoist") {
    const bed = world.points.get(r.room)!;
    objects.set(`${roomId}.hoist`, { id: `${roomId}.hoist`, roomId, at: { kind: "point", x: bed.x, y: bed.y } });
  }
}

/** How far a person is from an object (0 for something they carry). */
export function distanceTo(world: World, p: Person, o: TouchObject): number {
  switch (o.at.kind) {
    case "carried":
      return 0;
    case "point":
      return Math.hypot(p.x - o.at.x, p.y - o.at.y);
    case "rect": {
      const r = o.at;
      return Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
    }
    case "with": {
      const other = world.people.get(o.at.personId);
      return other ? Math.hypot(p.x - other.x, p.y - other.y) : Infinity;
    }
  }
}

/**
 * Records a touch if `personId` is on the map and within reach of the object. `from`: where they were
 * when they touched it, if they've moved on in this tick (walking back from the WC, out of the exit).
 */
export function touch(world: World, personId: string, objectId: string, from?: { x: number; y: number }): void {
  const b = world.building!;
  const p = world.people.get(personId);
  const o = b.objects.get(objectId);
  if (!p || (!p.onMap && !from) || !o || distanceTo(world, from ? { ...p, ...from } : p, o) > REACH_M) return;
  const t: Touch = { personId, objectId, t: world.t };
  b.touches.push(t);
  const remember = (map: Map<string, Touch[]>, key: string) => {
    const list = map.get(key) ?? [];
    list.unshift(t);
    if (list.length > RECENT) list.pop();
    map.set(key, list);
  };
  if (p.roomId) remember(b.recentByRoom, p.roomId);
  remember(b.recentByPerson, personId);
}

const bedOf = (world: World, residentId: string) => `${world.people.get(residentId)!.resident!.data.room}.bed`;

/** Touches from what happened this tick. */
function fromEvents(world: World, events: AnySimEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case "drink.served":
        touch(world, e.payload.staffId, `${e.payload.residentId}.cup`);
        if (e.payload.outcome === "drunk") touch(world, e.payload.residentId, `${e.payload.residentId}.cup`);
        break;
      case "meal.served":
        touch(world, e.payload.staffId, `${e.payload.residentId}.tray`);
        touch(world, e.payload.residentId, `${e.payload.residentId}.tray`);
        break;
      case "med.administered":
        touch(world, e.payload.staffId, "med_trolley");
        touch(world, e.payload.staffId, `${e.payload.residentId}.cup`);
        touch(world, e.payload.residentId, `${e.payload.residentId}.cup`);
        break;
      case "resident.requested_help":
        touch(world, e.payload.residentId, `${e.payload.residentId}.call_bell`);
        break;
      case "resident.transferred": {
        const room = world.points.get(world.people.get(e.payload.residentId)!.resident!.data.room)!.room;
        for (const s of e.payload.staffIds) {
          if (e.payload.method === "hoist") touch(world, s, `${room}.hoist`);
          touch(world, s, bedOf(world, e.payload.residentId));
        }
        break;
      }
      case "resident.repositioned":
        for (const s of e.payload.staffIds) touch(world, s, bedOf(world, e.payload.residentId));
        break;
      case "visitor.signed_in":
      case "visitor.signed_out":
        touch(world, e.payload.visitorId, "Reception.visitors_book");
        break;
      // In or out through the locked exit: the keypad (those leaving are off the map by now, at the door).
      case "person.arrived":
      case "person.departed":
        if (e.payload.pointId === "ExitDoor") {
          const p = world.people.get(e.actors[0]!)!;
          for (const k of world.building!.objects.keys()) if (k.endsWith(".keypad")) touch(world, p.id, k, { x: p.x, y: p.y });
        }
        break;
    }
  }
}

/** Touches from what each person has just started: a step of a task, a doorway, a walk, the end of a toilet visit. */
function fromSteps(world: World, building: BuildingState): void {
  for (const id of world.order) {
    const p = world.people.get(id)!;
    if (!p.onMap) {
      building.last.delete(id);
      continue;
    }
    const taskId = p.staff?.taskId ?? p.resident?.busyTaskId ?? null;
    const task = taskId ? world.tasks.get(taskId) : undefined;
    const node = task?.bt.node ?? null;
    const zone = p.heldZone;
    const moving = !!p.move;
    const last = building.last.get(id);
    if (!last) {
      building.last.set(id, { taskId, node, zone, moving, x: p.x, y: p.y });
      continue;
    }
    // Last tick's, then updated in place for the next.
    const was = { taskId: last.taskId, node: last.node, zone: last.zone, moving: last.moving, x: last.x, y: last.y };
    Object.assign(last, { taskId, node, zone, moving, x: p.x, y: p.y });
    const newStep = taskId !== was.taskId || node !== was.node;

    // Through a door that's shut (or ajar, or the locked exit): a hand on its handle or keypad.
    if (zone && zone !== was.zone) {
      const door = building.doors.get(zone);
      if (door && door.state !== "open") touch(world, id, door.rooms.includes("Outside") ? `${zone}.keypad` : `${zone}.handle`);
    }
    // Setting off with a walking aid.
    if (moving && !was.moving && p.resident) touch(world, id, `${id}.walking_aid`);
    // A resident moved in their wheelchair: the carer on the handles.
    if (moving && !was.moving && task?.residentId && p.staff && world.people.get(task.residentId)!.speed === 0) touch(world, id, `${task.residentId}.wheelchair`);

    if (task && newStep) {
      const care = String(task.data.care ?? "");
      const residentId = task.residentId;
      if (p.staff && residentId && node === "care" && task.kind === "care" && AT_THE_BED.has(care)) {
        touch(world, id, bedOf(world, residentId));
        if (care === "comfort") touch(world, id, `${residentId}.cup`);
      }
      if (p.staff && residentId && task.kind === "assist" && task.need === "toileting" && node === "care") touch(world, id, bedOf(world, residentId));
      if (p.staff && residentId && task.kind === "assist" && node === "at the WC") {
        const ensuite = world.people.get(residentId)!.roomId;
        if (ensuite) touch(world, id, `${ensuite}.wc`);
      }
      if (p.resident && node === "on the toilet" && p.roomId) touch(world, id, `${p.roomId}.wc`);
    }
    // The end of a visit to the WC: flushed, and hands washed at the basin, from where they sat (they
    // may already be setting off back in this tick).
    if (p.resident && newStep && (was.node === "on the toilet" || was.node === "at the WC")) usedToilet(world, p, id, { x: was.x, y: was.y });
  }
}

/** Once a tick, from the building observer. */
export function recordTouches(world: World, events: AnySimEvent[]): void {
  fromEvents(world, events);
  fromSteps(world, world.building!);
}

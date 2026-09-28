// Movement along A* paths, the doorway wait rule and arrivals (docs/02, docs/04).
// Runs every tick. Doorway zones are single-occupancy: a person entering one claims it and
// releases it on reaching the first cell beyond it; anyone else waits at the edge. A zone
// used during a tick stays closed until the next tick, so two people never cross a doorway
// within the same 5 seconds (which would look like passing through each other).

import { TICK_SECONDS } from "@vch/shared-types";
import { emit } from "../emit.js";
import type { Person, World } from "../state.js";
import { cellAt, cellCentre } from "./grid.js";
import { findPath } from "./pathfind.js";

const SEATED_POINTS = new Set(["seat", "chair", "wc"]);

/** Sends a person walking to a named point. Returns false if there is no path. */
export function walkTo(world: World, person: Person, pointId: string): boolean {
  const point = world.points.get(pointId);
  if (!point) throw new Error(`Unknown point "${pointId}"`);
  if (person.atPoint === pointId && !person.move) return true;
  const start = cellAt(world.grid, person.x, person.y);
  const goal = cellAt(world.grid, point.x, point.y);
  const cells = findPath(world.grid, start, goal);
  if (!cells) return false;
  person.move = { destPointId: pointId, cells, next: 0 };
  person.atPoint = null;
  person.posture = "walking";
  return true;
}

function zoneFree(world: World, zone: string): boolean {
  return !world.zoneOwner.has(zone) && (world.zoneReleasedTick.get(zone) ?? -1) < world.tick;
}

function claimZone(world: World, person: Person, zone: string): boolean {
  if (world.zoneOwner.get(zone) !== person.id && !zoneFree(world, zone)) return false;
  if (person.heldZone && person.heldZone !== zone) releaseZone(world, person);
  world.zoneOwner.set(zone, person.id);
  person.heldZone = zone;
  return true;
}

export function releaseZone(world: World, person: Person): void {
  if (person.heldZone && world.zoneOwner.get(person.heldZone) === person.id) {
    world.zoneOwner.delete(person.heldZone);
    world.zoneReleasedTick.set(person.heldZone, world.tick);
  }
  person.heldZone = null;
}

function enterCell(world: World, person: Person, cell: number): void {
  const roomId = world.grid.roomOf[cell] ?? null;
  if (roomId && roomId !== person.roomId) {
    emit(world, "person.entered_room", [person.id], { roomId, fromRoomId: person.roomId });
    person.roomId = roomId;
  }
  if (person.heldZone && world.grid.doorZoneOf[cell] !== person.heldZone) releaseZone(world, person);
}

/** Advances one person by one tick. Returns true if they arrived this tick. */
function stepPerson(world: World, person: Person): boolean {
  const move = person.move!;
  let budget = person.speed * TICK_SECONDS;
  while (budget > 1e-9 && move.next < move.cells.length) {
    const cell = move.cells[move.next]!;
    const zone = world.grid.doorZoneOf[cell];
    if (zone && person.heldZone !== zone && !claimZone(world, person, zone)) {
      if (person.waitingAtDoor !== zone) {
        person.waitingAtDoor = zone;
        emit(world, "person.waited_at_door", [person.id], { doorId: zone });
      }
      return false;
    }
    person.waitingAtDoor = null;
    const isLast = move.next === move.cells.length - 1;
    const dest = world.points.get(move.destPointId)!;
    const target = isLast ? { x: dest.x, y: dest.y } : cellCentre(world.grid, cell);
    const dist = Math.hypot(target.x - person.x, target.y - person.y);
    if (dist <= budget) {
      person.x = target.x;
      person.y = target.y;
      budget -= dist;
      move.next += 1;
      enterCell(world, person, cell);
    } else {
      person.x += ((target.x - person.x) / dist) * budget;
      person.y += ((target.y - person.y) / dist) * budget;
      budget = 0;
    }
  }
  if (move.next < move.cells.length) return false;
  const dest = world.points.get(move.destPointId)!;
  person.move = null;
  person.atPoint = dest.id;
  person.posture = SEATED_POINTS.has(dest.kind) ? "sitting" : "standing";
  return true;
}

/** Moves everyone who is walking; returns the ids of people who arrived this tick. */
export function moveAll(world: World): string[] {
  const arrived: string[] = [];
  for (const id of world.order) {
    const person = world.people.get(id)!;
    if (person.onMap && person.move && stepPerson(world, person)) arrived.push(id);
  }
  return arrived;
}

/** Places people waiting outside at the exit door, one at a time as the doorway clears. */
export function spawnWaiting(world: World): string[] {
  const spawned: string[] = [];
  const exit = world.points.get("ExitDoor")!;
  const zone = world.grid.doorZoneOf[cellAt(world.grid, exit.x, exit.y)]!;
  while (world.spawnQueue.length > 0 && zoneFree(world, zone)) {
    const person = world.people.get(world.spawnQueue.shift()!)!;
    person.onMap = true;
    person.x = exit.x;
    person.y = exit.y;
    person.atPoint = "ExitDoor";
    person.posture = "standing";
    person.roomId = null;
    claimZone(world, person, zone);
    emit(world, "person.arrived", [person.id], { pointId: "ExitDoor" });
    enterCell(world, person, cellAt(world.grid, exit.x, exit.y));
    spawned.push(person.id);
  }
  return spawned;
}

/** Takes a person standing at the exit door off the map. */
export function depart(world: World, person: Person): void {
  releaseZone(world, person);
  person.onMap = false;
  person.move = null;
  person.atPoint = null;
  person.roomId = null;
  person.waitingAtDoor = null;
  emit(world, "person.departed", [person.id], { pointId: "ExitDoor" });
}

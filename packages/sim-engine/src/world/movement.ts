// Movement along A* paths, standing spots, the doorway wait rule and arrivals (docs/02, docs/04).
// Runs every tick.
// - Doorway zones are single-occupancy: a person entering one claims it and releases it on
//   reaching the first cell beyond it; anyone else waits at the edge. A zone used during a tick
//   stays closed until the next tick, so two people never cross a doorway within 5 seconds.
// - Standing spots: everyone who stops somewhere claims that grid cell. If a destination's cell
//   is taken, the person goes to the nearest free cell in the same room instead.

import { TICK_SECONDS, type NamedPoint } from "@vch/shared-types";
import { emit } from "../emit.js";
import type { Person, World } from "../state.js";
import { cellAt, cellCentre, neighbours } from "./grid.js";
import { findPath } from "./pathfind.js";

const SEATED_POINTS = new Set(["seat", "chair", "wheelchair", "wc"]);
/** Rooms where staff sit at seats: breaks and handovers, reception and office work. */
const STAFF_SEAT_ROOMS = new Set(["staff", "reception"]);

/**
 * Whether someone sits on arriving exactly at a point. Only residents use a WC seat. Staff sit
 * in the staff room and at reception; anywhere else they stand (tidying, restocking), unless
 * they're sitting with a resident (idle.ts sits them down on arrival). Visitors sit where they're shown.
 */
function sitsAt(world: World, person: Person, point: NamedPoint): boolean {
  if (!SEATED_POINTS.has(point.kind)) return false;
  if (point.kind === "wc" || point.kind === "wheelchair") return !!person.resident;
  if (!person.staff) return true;
  const kind = world.data.floorplan.rooms.find((r) => r.id === point.room)?.kind;
  return !!kind && STAFF_SEAT_ROOMS.has(kind);
}

/**
 * Where someone actually stands for a point. Anyone but a resident sent to a WC (a carer helping,
 * a visitor) stands at the standing point beside it; like any displaced spot, they're still "at"
 * the WC point for the task.
 */
function spotFor(world: World, person: Person, point: NamedPoint): NamedPoint {
  if (point.kind !== "wc" || person.resident) return point;
  return world.points.get(`${point.id}.Stand`) ?? point;
}

function claimFree(world: World, cell: number, person: Person): boolean {
  const owner = world.standClaims.get(cell);
  return owner === undefined || owner === person.id;
}

export function releaseStand(world: World, person: Person): void {
  if (person.standCell !== null && world.standClaims.get(person.standCell) === person.id) world.standClaims.delete(person.standCell);
  person.standCell = null;
}

function claimStand(world: World, person: Person, cell: number): void {
  releaseStand(world, person);
  world.standClaims.set(cell, person.id);
  person.standCell = cell;
}

/**
 * The cell a person should stand on for a point: the point's own cell if free, otherwise the
 * nearest free walkable cell in the same room that isn't a doorway. The exit is never claimed
 * (people pass straight through it).
 */
export function standingCell(world: World, person: Person, point: NamedPoint): number {
  const { grid } = world;
  const home = cellAt(grid, point.x, point.y);
  if (point.kind === "exit" || claimFree(world, home, person)) return home;
  const seen = new Set([home]);
  let frontier = [home];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const cell of frontier) {
      for (const { cell: n } of neighbours(grid, cell)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (grid.roomOf[n] !== point.room) continue;
        // Never displaced onto a WC seat.
        if (!grid.doorZoneOf[n] && !wcCell(world, n) && claimFree(world, n, person)) return n;
        next.push(n);
      }
    }
    frontier = next.sort((a, b) => a - b);
  }
  return home;
}

function wcCell(world: World, cell: number): boolean {
  for (const p of world.points.values()) if (p.kind === "wc" && cellAt(world.grid, p.x, p.y) === cell) return true;
  return false;
}

/** Notes where someone is as a turning point for this tick (display only: World.trail). */
function noteTurn(world: World, person: Person): void {
  const list = world.trail.get(person.id);
  const last = list?.[list.length - 1];
  if (last && last.x === person.x && last.y === person.y) return;
  if (list) list.push({ x: person.x, y: person.y });
  else world.trail.set(person.id, [{ x: person.x, y: person.y }]);
}

/** Sends a person walking to a named point. Returns false if there is no path. */
export function walkTo(world: World, person: Person, pointId: string): boolean {
  const point = world.points.get(pointId);
  if (!point) throw new Error(`Unknown point "${pointId}"`);
  if (person.move?.destPointId === pointId) return true;
  if (person.atPoint === pointId && !person.move) return true;
  const goal = standingCell(world, person, spotFor(world, person, point));
  const start = cellAt(world.grid, person.x, person.y);
  const cells = findPath(world.grid, start, goal);
  if (!cells) return false;
  const exact = goal === cellAt(world.grid, point.x, point.y);
  const end = exact ? { x: point.x, y: point.y } : cellCentre(world.grid, goal);
  if (point.kind === "exit") releaseStand(world, person);
  else claimStand(world, person, goal);
  if (person.move) noteTurn(world, person); // re-routed mid-walk: they turn here
  person.move = { destPointId: pointId, cells, next: 0, endX: end.x, endY: end.y };
  person.atPoint = null;
  person.posture = "walking";
  return true;
}

/**
 * Walks a person along the route someone else is walking, then on to their own point: a carer beside
 * the resident they're escorting takes the same way round furniture and through the same doors,
 * rather than a different route of the same length. Falls back to their own route.
 */
export function walkAlong(world: World, person: Person, pointId: string, leader: Person): boolean {
  if (!walkTo(world, person, pointId)) return false;
  const lead = leader.move;
  const move = person.move;
  if (!lead || !move || move.destPointId !== pointId) return true;
  // Not through the cell the resident is in (the WC or chair they're getting up from).
  const via = lead.cells.slice(lead.next, -1).filter((cell) => cell !== cellAt(world.grid, leader.x, leader.y));
  if (via.length === 0) return true;
  const head = findPath(world.grid, cellAt(world.grid, person.x, person.y), via[0]!);
  const tail = findPath(world.grid, via[via.length - 1]!, move.cells[move.cells.length - 1]!);
  if (!head || !tail) return true;
  Object.assign(move, { cells: [...head, ...via.slice(1), ...tail.slice(1)], next: 0, tail: tail.length - 1 });
  return true;
}

/** How much of a walk is left, not counting a carer's last step off the route they share (`Move.tail`). */
export function routeLeft(q: Person): number {
  return q.move ? q.move.cells.length - q.move.next - (q.move.tail ?? 0) : 0;
}

/**
 * Moves a person's room, logging `person.entered_room` whenever it changes (docs/07: room
 * occupancy is rebuilt from these events). The initial placement, before the first tick, is silent.
 */
export function setRoom(world: World, person: Person, roomId: string | null): void {
  if (roomId === person.roomId) return;
  if (roomId !== null && world.tick > 0) emit(world, "person.entered_room", [person.id], { roomId, fromRoomId: person.roomId });
  person.roomId = roomId;
}

/** Puts a person straight onto a point (initial placement, a hoist transfer), respecting standing spots. */
export function placeAt(world: World, person: Person, pointId: string): void {
  const point = world.points.get(pointId)!;
  const cell = standingCell(world, person, spotFor(world, person, point));
  const exact = cell === cellAt(world.grid, point.x, point.y);
  const pos = exact ? { x: point.x, y: point.y } : cellCentre(world.grid, cell);
  claimStand(world, person, cell);
  setRoom(world, person, point.room);
  Object.assign(person, { onMap: true, x: pos.x, y: pos.y, atPoint: pointId, move: null });
  person.posture = exact && sitsAt(world, person, point) ? "sitting" : "standing";
  noteTurn(world, person);
}

/** A resident at their bedside gets into bed (the bed cell isn't walkable, so no claim). */
export function getIntoBed(world: World, person: Person): void {
  const bed = world.points.get(person.resident!.data.room)!;
  releaseStand(world, person);
  setRoom(world, person, bed.room);
  Object.assign(person, { x: bed.x, y: bed.y, atPoint: bed.id, move: null, posture: "in_bed" });
  person.resident!.inBed = true;
  noteTurn(world, person);
}

/** A resident gets out of bed onto the bedside (or the nearest free cell to it). */
export function getOutOfBed(world: World, person: Person): void {
  placeAt(world, person, `${person.resident!.data.room}.Side`);
  person.resident!.inBed = false;
}

function claimZone(world: World, person: Person, zone: string): boolean {
  // A doorway left this tick stays closed until the next, except to the person walking with whoever
  // just left it (a carer escorting a resident follows them straight through): still one at a time.
  const following = !!person.move?.with && world.zoneReleasedBy.get(zone) === person.move.with;
  const free = !world.zoneOwner.has(zone) && ((world.zoneReleasedTick.get(zone) ?? -1) < world.tick || following);
  if (world.zoneOwner.get(zone) !== person.id && !free) return false;
  if (person.heldZone && person.heldZone !== zone) releaseZone(world, person);
  world.zoneOwner.set(zone, person.id);
  person.heldZone = zone;
  return true;
}

export function releaseZone(world: World, person: Person): void {
  if (person.heldZone && world.zoneOwner.get(person.heldZone) === person.id) {
    world.zoneOwner.delete(person.heldZone);
    world.zoneReleasedTick.set(person.heldZone, world.tick);
    world.zoneReleasedBy.set(person.heldZone, person.id);
  }
  person.heldZone = null;
}

function enterCell(world: World, person: Person, cell: number): void {
  const roomId = world.grid.roomOf[cell] ?? null;
  if (roomId) setRoom(world, person, roomId);
  if (person.heldZone && world.grid.doorZoneOf[cell] !== person.heldZone) releaseZone(world, person);
}

/** Advances one person by one tick. Returns true if they arrived this tick. */
function stepPerson(world: World, person: Person): boolean {
  const move = person.move!;
  // A carer walking beside a resident keeps to the resident's pace (move.pace).
  let budget = (move.pace ?? person.speed) * TICK_SECONDS;
  // A carer and the resident they're escorting: whoever is ahead (less of the shared route left; the
  // carer, when level) stops rather than step further than the tether from the other, unless in a doorway
  // (which they clear, so the other can follow) or the other has stopped. The one behind always walks
  // on, so they never both wait.
  const partner = move.tether !== undefined && move.with ? world.people.get(move.with) : undefined;
  const leash = partner?.move && partner.move.pace !== 0 ? partner : undefined;
  const tooFar = (x: number, y: number, zone: string | null | undefined): boolean => {
    if (!leash) return false;
    const mine = routeLeft(person);
    const theirs = routeLeft(leash);
    if (mine > theirs || (mine === theirs && !person.staff)) return false;
    // Clearing a doorway they hold (or moving on when the other waits for it) never stops them in it.
    if (person.heldZone && (!zone || zone === person.heldZone || leash.waitingAtDoor === person.heldZone)) return false;
    const after = Math.hypot(x - leash.x, y - leash.y);
    return after > move.tether! && after > Math.hypot(person.x - leash.x, person.y - leash.y);
  };
  while (budget > 1e-9 && move.next < move.cells.length) {
    const cell = move.cells[move.next]!;
    const zone = world.grid.doorZoneOf[cell];
    const isLast = move.next === move.cells.length - 1;
    const target = isLast ? { x: move.endX, y: move.endY } : cellCentre(world.grid, cell);
    const dist = Math.hypot(target.x - person.x, target.y - person.y);
    const share = dist > 0 ? Math.min(dist, budget) / dist : 0;
    const partX = person.x + (target.x - person.x) * share;
    const partY = person.y + (target.y - person.y) * share;
    if (tooFar(partX, partY, zone)) break;
    if (zone && person.heldZone !== zone && !claimZone(world, person, zone)) {
      if (person.waitingAtDoor !== zone) {
        person.waitingAtDoor = zone;
        emit(world, "person.waited_at_door", [person.id], { doorId: zone });
      }
      return false;
    }
    person.waitingAtDoor = null;
    if (dist <= budget) {
      const from = { x: person.x, y: person.y };
      person.x = target.x;
      person.y = target.y;
      budget -= dist;
      move.next += 1;
      enterCell(world, person, cell);
      // Turning points for the browser: path corners, doorway cells and the end of the walk.
      if (isLast || world.grid.doorZoneOf[cell]) noteTurn(world, person);
      else {
        const nextCell = move.cells[move.next]!;
        const after = move.next === move.cells.length - 1 ? { x: move.endX, y: move.endY } : cellCentre(world.grid, nextCell);
        const cross = (target.x - from.x) * (after.y - target.y) - (target.y - from.y) * (after.x - target.x);
        const dot = (target.x - from.x) * (after.x - target.x) + (target.y - from.y) * (after.y - target.y);
        if (Math.abs(cross) > 1e-9 || dot < 0) noteTurn(world, person);
      }
    } else {
      person.x = partX;
      person.y = partY;
      budget = 0;
    }
  }
  if (move.next < move.cells.length) return false;
  const dest = world.points.get(move.destPointId)!;
  const exact = person.x === dest.x && person.y === dest.y;
  person.move = null;
  person.atPoint = dest.id;
  person.posture = exact && sitsAt(world, person, dest) ? "sitting" : "standing";
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
  while (world.spawnQueue.length > 0) {
    const person = world.people.get(world.spawnQueue[0]!)!;
    if (!claimZone(world, person, zone)) break;
    world.spawnQueue.shift();
    person.onMap = true;
    person.x = exit.x;
    person.y = exit.y;
    person.atPoint = "ExitDoor";
    person.posture = "standing";
    person.roomId = null;
    emit(world, "person.arrived", [person.id], { pointId: "ExitDoor" });
    enterCell(world, person, cellAt(world.grid, exit.x, exit.y));
    noteTurn(world, person);
    spawned.push(person.id);
  }
  return spawned;
}

/** Takes a person standing at the exit door off the map. */
export function depart(world: World, person: Person): void {
  releaseZone(world, person);
  releaseStand(world, person);
  person.onMap = false;
  person.move = null;
  person.atPoint = null;
  person.roomId = null;
  person.waitingAtDoor = null;
  person.badges = [];
  person.task = null;
  emit(world, "person.departed", [person.id], { pointId: "ExitDoor" });
}

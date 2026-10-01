// The world description (v1.0-testbed): everything external models read each step, built from
// the world. Pure: no random numbers, no writes, so calling it or not never changes a run.

import { WORLD_SCHEMA, type RoomDetail, type WorldDescription } from "@vch/shared-types";
import { activityOf } from "./activity.js";
import { doorStates, windowStates } from "./building.js";
import type { World } from "./state.js";
import { weatherAt } from "./weather.js";

export function describeWorld(world: World): WorldDescription {
  const people = world.order.map((id) => world.people.get(id)!).filter((p) => p.onMap).map((p) => activityOf(world, p));
  return {
    schema: WORLD_SCHEMA,
    t: world.t,
    tick: world.tick,
    people,
    doors: doorStates(world),
    windows: windowStates(world),
    equipment: [],
    touches: [],
    weather: world.data.weather ? weatherAt(world.data.weather, world.t) : null,
  };
}

/** One room's slice of the description, for the inspector. */
export function describeRoom(world: World, roomId: string): RoomDetail | null {
  const room = world.data.floorplan.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const description = describeWorld(world);
  const within = (r: typeof room) => r.rect.x >= room.rect.x && r.rect.y >= room.rect.y && r.rect.x + r.rect.w <= room.rect.x + room.rect.w && r.rect.y + r.rect.h <= room.rect.y + room.rect.h;
  const inside = new Set(world.data.floorplan.rooms.filter(within).map((r) => r.id));
  return {
    roomId,
    name: room.name,
    kind: room.kind,
    areaM2: room.floor_area_m2,
    ceilingM: room.ceiling_height_m,
    t: world.t,
    doors: description.doors.filter((d) => d.rooms.includes(roomId)),
    windows: description.windows.filter((w) => w.roomId === roomId),
    // A bedroom includes its en-suite (a room inside it): each person keeps their own roomId.
    people: description.people.filter((p) => p.roomId !== null && inside.has(p.roomId)).map((p) => ({ ...p, name: world.people.get(p.personId)!.name })),
    weather: description.weather,
  };
}

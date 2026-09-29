import type { AnySimEvent, EventPayloads, EventType, Source } from "@vch/shared-types";
import type { World } from "./state.js";

/** Appends an event to this tick's output. Ids derive from the sequence number (docs/07). */
export function emit<K extends EventType>(
  world: World,
  type: K,
  actors: string[],
  payload: EventPayloads[K],
  source: Source = "engine",
): void {
  world.seq += 1;
  world.pending.push({ id: `e${world.seq}`, seq: world.seq, tick: world.tick, t: world.t, type, actors, payload, source } as AnySimEvent);
}

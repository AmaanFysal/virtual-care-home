# ADR 0001: Five-second engine tick with per-minute decisions

- **Status:** Accepted
- **Date:** 2026-09-28
- **Deciders:** Amaan Fysal
- **Affected docs:** docs/03-simulation-engine.md, docs/04-agents-and-behaviour.md

## Context

The plan specified one sim minute per tick. People walk 0.3 to 1.2 m/s, so in one sim minute staff cover about 72 m and even a frail resident covers about 24 m. The whole wing is 20 m wide, so with one-minute ticks people would jump between rooms in a single step. The doorway wait rule would never trigger, and "who is in which room right now" would be wrong between ticks.

## Decision

We will run the engine on a fixed tick of 5 sim seconds.

- Movement and behaviour-tree steps advance every tick (staff move about 6 m per tick, Peggy about 2 m), so procedures move on as soon as someone arrives, with no idle gap.
- Needs decay, the rota, visitor arrivals and utility decisions (choosing what to do next) run every 12th tick (once per sim minute), so the logical model stays minute-based as the plan intended.
- The server's pacer, not the engine, maps clock speeds to ticks per real second: 1x = 0.2, 10x = 2, 60x = 12, 360x = 72.
- Sim time is integer seconds since Monday 2026-11-02 00:00.

## Consequences

- Movement, door occupancy and room membership are accurate to 5 s; the client interpolates between deltas for smooth drawing.
- A sim day is 17,280 ticks. The engine must stay cheap per tick (41 agents; A* only on re-plan, not every tick).
- Position changes are not logged as events (too many); the log records room entries and task events instead.

## Alternatives considered

- **1-minute tick with movement sub-steps:** two notions of time inside the engine for no gain.
- **1-minute tick with timestamped paths interpolated by the client:** simplest, but doorway waits and room membership become approximate.

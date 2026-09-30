# 03 · Simulation engine

**Purpose:** the tick loop, sim clock, system order, seeded RNG and input handling inside `packages/sim-engine`.

> Status: decided for Phase 1 (2026-09-28). Source: [plan-v2](research/plan-v2.md) (Backend architecture), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §4. Decision record: [ADR-0001](adr/0001-five-second-tick.md).

## Time

- **Tick:** 5 sim seconds. A sim day is 17,280 ticks.
- **Sim time:** integer seconds since **Monday 2026-11-02 00:00** (the sim epoch). Day of week = `floor(t / 86400) % 7` (0 = Monday); time of day = `t % 86400`. No time zones or daylight saving.
- **Default start:** Tuesday 2026-11-03 06:00, `t = 108000`.
- **Minute boundary:** every 12th tick (`t % 60 === 0`).

## Clock and pacing

The engine has no clock of its own. It exposes `step()`, which advances exactly one tick. Everything about real time lives in `apps/server`:

| Speed | Ticks per real second | One sim day takes |
|---|---|---|
| Paused | 0 | — |
| 1x | 0.2 | 24 h |
| 10x | 2 | 2.4 h |
| 60x | 12 | 24 min |
| 360x | 72 | 4 min |

- **Step** (while paused) runs one tick.
- **Headless runs** (tests, the CLI, the acceptance test) call `step()` in a loop with no pacing.

## System order per tick

1. **Inputs:** apply every queued input whose `applyTick` is this tick, in `seq` order, then any director events that are due (docs/10).
2. On a minute boundary only:
   1. **Rota:** shift starts and ends, arrivals and departures, agency spawns, breaks due. At 00:00, with the director on, the director then plans the day. Then infections move on and spread (only while someone is infected, docs/10).
   2. **Visitors:** at 00:00 sample the day's visits; spawn arrivals that are due.
   3. **Needs:** decay needs and staff workload by one minute.
   4. **Decisions:** raise help requests; create scheduled tasks (rounds, checks, meals); assign tasks to staff by utility; residents pick self-care actions.
3. **Behaviour trees:** tick every active tree once.
4. **Spawning:** people waiting outside enter at `ExitDoor`, one per clear doorway.
5. **Movement:** advance every walking person along their path, with doorway reservations ([04](04-agents-and-behaviour.md)).
6. **Arrivals:** the rota (and, from M4a, behaviour trees) react to people who reached their destination.
7. **Invariants:** checked by the test harness after each tick; the server logs violations as `invariant.violated`.

Within each system, people are processed in ascending id order.

## Randomness

- **Algorithm:** sfc32, seeded from a 32-bit hash of the run seed.
- **Streams:** each system gets its own stream derived from the seed and a fixed name (`rota`, `visitors`, `needs`, `decisions`, `meds`, `falls`, `movement`, `director`, `cover`, `infection`). A new random draw in one system never shifts another system's sequence. The `director` stream is drawn only by the scenario director's daily plans, `cover` only by the cover rule for absences, and `infection` only while someone is infected, so with the director off and nothing injected none of them is used.
- **Rule:** `Math.random()` is never used in `packages/sim-engine` (constitution rule 2).

## Inputs

An input is anything from outside the engine that changes the world: `inject_fall`, `staff_sick`, `shift_no_show` and `infection_case` (docs/10). `createSim` also takes `config` (data/director.json) for the rules these trigger when the director is off; the server always passes it.

- The server stamps each manual input with a monotonically increasing `seq`, the `source` (`user`), and `applyTick = currentTick + 1`, then logs it before handing it to the engine.
- The scenario director plans its own inputs inside the engine (`source: "director"`), from the seed, the director settings and the scenario file. It logs each one as `director.planned` and applies it through the same dispatch (`applyInput`).
- An input that can't apply when its time comes is logged as `input.skipped` with the reason.
- Clock commands (pause, step, speed) are not engine inputs. They change pacing only and cannot change the run.
- **Replay:** seed + data version + director settings and scenario (if on) + the ordered input list reproduces the run exactly.

## Engine API (Phase 1)

```ts
createSim({ seed, data, startTime?, director? }): Sim   // director: { config, random, scenario?, deaths? }; off when absent
sim.step(): SimEvent[]            // advance one tick, return events emitted
sim.enqueue(input: SimInput): void
sim.state(): WorldState           // full state for snapshot-on-connect and inspection
sim.tick / sim.time               // current tick and sim seconds
```

The engine is pure TypeScript with no I/O. Data comes in as parsed JSON (validated with `validateData`; `createSim` throws on invalid data); events come out as return values. `sim.started` carries a `dataVersion`, an FNV-1a hash of the data, so a log records exactly which data produced it. Sim dates for any year come from `simDate(t)` (`shared-types/time.ts`), used for seasons.

Node-only helpers live outside `src/`: `tools/load-data.ts` (exported as `@vch/sim-engine/load-data`) and the headless CLI `scripts/sim.ts`.

## Rota in the engine (M2)

- Each day's shifts are planned at 00:00 (and for the start day and the previous night at creation). Named staff arrive 5 to 15 minutes early, agency workers 0 to 10, drawn from the `rota` stream.
- Arriving staff wait in the staff room until their shift starts, then go to a placeholder post (leads and night carer `Corridor.Mid`, CAs `Corridor.West`, RN `Corridor.East`) until M4a adds tasks and handovers. Joanne works at the office desk in reception (`Reception.Office`), Bev in the waiting area, Sanjay at the reception desk; the staff room stays for handovers and breaks.
- Agency workers (`agy_001`, ...) are created when their day is planned, named from the pool without repeats that day, and removed a day after they leave.

## Performance budget

A sim day is 17,280 ticks. The headless acceptance test runs a day in a few seconds, so the average cost is below 0.2 ms per tick. At 360x the server needs 72 ticks per real second, which is easily within budget. A* runs only when a person gets a new destination or their path is blocked, never every tick.

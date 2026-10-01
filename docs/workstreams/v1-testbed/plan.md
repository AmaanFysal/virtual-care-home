# Plan: v1.0-testbed, Part 1 (the world description)

> Approved by the project owner on 2026-10-01, with Dennis's door ajar at night as a best-interests decision. Two PRs, each ending with something visible in the browser and stopping for review. Part 2 (the plug-in API) gets its own discussion once Part 1 is built.

## Approach

- **One observer, last in each tick** (`src/building.ts`): it reads the world and the tick's events, writes only `world.building`, and appends its events after the tick's others. Nothing reads its state and it draws no random numbers, so behaviour can't change (spec decision 2).
- **`sim.describe()`** builds the description from the world. Pure, so calling it never changes a run.
- **The proof:** the director-off fingerprints match unchanged once building events are left out and the rest renumbered.

## Tasks

| PR | What | Done when |
|---|---|---|
| 1 (this branch, `v1-testbed`) | **People, doors, windows and weather.** The world description (schema 1) with activity and MET (2024 Compendium), door states and rules, windows in the floor plan with restrictors and weather rules, London's hourly weather (Open-Meteo, Oct 2025 to Sep 2026), `describe` CLI, `START` / `--start`. Browser: door leaves and open windows on the map, weather in the clock bar, a room inspector (click a room's floor), activity in the person inspector, a Building filter | Director-off fingerprints unchanged; doors and windows follow their rules every tick (`building.test.ts`); the description is deterministic and never changes a run (`describe.test.ts`); data validated; visible in the browser |
| 2 (`v1-testbed-2`) | **Equipment and touches; schema 1 complete.** Lights, heating (22 °C day rooms, 21 °C bedrooms), the Lounge TV, the staff-room kettle, WC flushes, showers described but off; touches from task steps and events; lights and TV drawn; equipment and recent touches in the inspectors | Fingerprints still unchanged; equipment rules hold every tick; every touch in reach; visible in the browser |

## Night-time doors (decision 6, reviewed 2026-10-01)

| Resident | Night door | Why |
|---|---|---|
| Arthur | closed | His card: "noise at night", "not disturbed at night more than necessary" |
| Win, Raj, Peggy, Kamala | closed | Nothing on the card says otherwise (Peggy: "men in the room at night" is a trigger) |
| Stan | ajar | His card: the corridor light left on at night; dark rooms upset him |
| Dennis | ajar | Best-interests decision (project owner): end of life, regular night turns, can't call for help |

## Risks

- **Run time:** the observer adds about 20% to a run (1.6 µs a tick). Two 16-day scenario replays now have explicit test timeouts.
- **Hoisting is instant in the engine,** so hoisting shows on that tick only.
- **The world description is a contract:** any change bumps `WORLD_SCHEMA`.

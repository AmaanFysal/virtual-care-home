# Workstream spec: v1.0-testbed

**Goal:** turn the wing into a test bed that external models (air, heat, surfaces, energy) can plug into. The engine publishes a **world description** every step: what people are doing and how hard, what they touch, the doors and windows, the equipment in use, and the outdoor weather. The physical effects stay outside the engine (constitution rule 4, ADR-0006).

Source: [roadmap](../../roadmap.md) (v1.0-testbed), [ADR-0006](../../adr/0006-equipment-and-weather-in-the-world-description.md). Constraints: [00-constitution](../../00-constitution.md).
Status: **approved 2026-10-01**, with the answers recorded as decisions 4 to 7. Tasks and PRs are in [plan.md](plan.md).

## Decisions (project owner, 2026-10-01)

1. **Build it now.** The full scenario audit was paused for this milestone, then removed with the rest of the care-perfection work on 2026-10-01 (docs/12, docs/roadmap.md).
2. **Describe, with a few light rules.** Doors, windows and equipment follow what people already do (a bedroom door closed for personal care, the Lounge TV on while someone is watching), plus a few rules of their own (doors at night, windows by the weather). They never change what people do. Opening a door takes no extra time and never stops anyone. Care timing and every existing event stay the same.
3. **Weather from a real hourly data file**, checked into `data/`, the same in every run.
4. **Weather for London:** the most recent complete 12 months of Open-Meteo hourly data, mapped onto the sim's calendar by date, credited in `CREDITS.md`.
5. **Showers stay off.** No behaviour change in this milestone; shower days stay in the backlog.
6. **Bedroom doors are closed at night** unless the resident's card says otherwise. Each resident's night-time door preference is drafted and listed for the project owner's review before it's used.
7. **Heating set points are data,** defaulting to 22 °C in day rooms and 21 °C in bedrooms.
8. **Lean PRs:** as few as makes sense, each ending with something the project owner can see in the browser, and each stopping for review.

## In scope

**Part 1: the world description** (this spec; the PRs are in the plan):
- each person's activity and its intensity;
- touches on objects;
- doors and windows, with their states and the rules that change them;
- equipment in use: showers, the Lounge TV, the staff-room kettle, lights, heating;
- the outdoor weather;
- the browser drawing all of it.

**Part 2: the plug-in API** (lockstep with the engine, plug-in results recorded as inputs with `source: "external"`). It's part of the milestone, but gets its own design discussion once Part 1 is built, because what plug-ins need to send back is clearer then. It's sketched at the end of this spec.

## The world description

A new versioned contract in `shared-types` (`world.ts`). Plug-ins will depend on it, so every change to it bumps `schema` (ADR-0006).

```ts
interface WorldDescription {
  schema: 1;
  t: number;
  tick: number;
  people: PersonActivity[];       // everyone on the map
  doors: DoorState[];
  windows: WindowState[];
  equipment: EquipmentState[];
  touches: Touch[];               // since the previous tick
  weather: Weather;               // the current hour
}
```

- `sim.describe()` returns it for the current tick. It's built from the engine's state and draws no random numbers, so calling it or not never changes a run.
- **It isn't stored.** A run is deterministic, so any tick's description is rebuilt by replaying the run. The event log records state changes (below), never positions or touches (docs/07).

### Activity and intensity

```ts
interface PersonActivity {
  personId: string; roomId: string; x: number; y: number;
  activity: Activity;           // "sleeping" | "lying" | "sitting" | "standing" | "walking" | "eating" | "personal_care" | "hoisting" | "being_hoisted" | "on_floor" | ...
  met: number;                  // metabolic equivalent
  intensity: "sedentary" | "light" | "moderate" | "vigorous";
}
```

- **Activity comes from what the engine already knows:** posture, whether they're asleep, walking, the task and its behaviour-tree step. For example, a carer on the wash step of morning care is `personal_care`; two carers on a hoist transfer are `hoisting` and the resident is `being_hoisted`; Joanne at her desk is `sitting`.
- **MET values come from the 2024 Compendium of Physical Activities.** Residents use the Older Adult Compendium; staff and visitors use the Adult Compendium. The values and their Compendium codes go in `data/activities.json`, each looked up in the source rather than estimated.
- **Intensity bands follow the Compendium's MET bands:** sedentary below 1.5, light 1.5 to 2.9, moderate 3.0 to 5.9, vigorous 6.0 or more.

### Doors

```ts
interface DoorState { doorId: string; state: "open" | "ajar" | "closed" | "locked"; heldBy: string | null }
```

- **Set states** come from rules, and each change is logged:
  - **Bedroom door** (`D_RoomN`):
    - closed for personal care (morning and bedtime care, pad changes, turns, help with the toilet), then back to its usual state;
    - by day, open;
    - at night (from bedtime care until they wake), closed unless the resident's card says otherwise (decision 6).
    - The preference is a new optional card field, `care.door_at_night: "open" | "ajar" | "closed"` (closed when absent). Each resident's value is drafted from their card and listed for the project owner's review before it's used.
  - **En-suite door:** closed while someone is in the en-suite, otherwise ajar.
  - **Staff room:** closed. **Exit door:** locked (keypad).
  - **Lounge, waiting area and reception doors:** held open by day on door holders (as fire doors are in care homes), closed from 22:00 to 07:00.
- **Passing through:** anyone in a closed or locked door's doorway cells holds it open (`heldBy`) and touches its handle (or the keypad). It returns to its set state when they've passed.
  - These openings appear in the description, not in the log: there are about 90 a day, and they're rebuilt exactly by replay.
  - Passing through takes no extra time (decision 2).

### Windows

```ts
interface WindowState { windowId: string; roomId: string; state: "closed" | "open"; openingMm: number }
```

- **Windows are added to the floor plan** (`windows` in `floorplan.json`, validated like doors):
  - one in each bedroom, in the outer wall above the bed;
  - three along the Lounge's north wall (its other walls face the corridor and the main building);
  - one each in the waiting area, reception and the staff room, on the front wall.
  - The corridor and en-suites have none.
- **Restricted opening.** Every window opens 100 mm at most, as HSE guidance asks of window restrictors in care homes. `openingMm` is 100 when open and 0 when closed.
- **Rules**, read against the weather:
  - **When staff open a window:** a member of staff in a resident's room after morning care opens it if it's 12 °C or warmer outside, dry, and the wind is below 10 m/s. Any member of staff in the Lounge opens one there by day on the same terms.
  - **When it's closed:** by a member of staff in the room once it's been open 30 minutes or the weather turns (rain, cold or wind), at bedtime care, and at 20:00 at the latest. Each window opens at most once a day.
  - The thresholds go in `data/building.json` with their sources. Opening a window is a touch, not extra time.

### Equipment

```ts
interface EquipmentState { equipmentId: string; kind: "shower" | "tv" | "kettle" | "light" | "heating" | "wc"; roomId: string; on: boolean; level?: "dim" | "full"; setpointC?: number }
```

| Equipment | Where | Rule |
|---|---|---|
| Lights | Every room | **Bedrooms and staff room:** on while someone awake is there and it's dark outside, or always in a room without a window. **Bedrooms at night:** off while the resident sleeps; dim for a night check. **Corridor:** full by day, dim from 22:00 to 07:00 (docs/02's night lights). **Reception:** always on. **En-suites:** on while in use |
| Heating | A radiator in every room with a window, plus the corridor | A heating season (October to April) and a set point by room type from `data/building.json`: 22 °C in day rooms (Lounge, waiting area, reception, staff room, corridor) and 21 °C in bedrooms and en-suites by default (decision 7). The engine publishes whether heating is on and the set point; whether the radiator gives out heat depends on the room's temperature, which is the heat model's job |
| Lounge TV | Lounge | On while any resident there is watching (Lounge activity `tv`), off when the last one stops |
| Kettle | Staff room | On for 3 minutes at the start of each break (tea) |
| WC | Each en-suite | Flushed at the end of each use (an instant use: `equipment.used`) |
| Shower | Each en-suite | Described, but never on in this milestone: shower days stay in the backlog (decision 5) |

Each change is logged (below). The equipment list is data (`floorplan.json` `equipment`), so a plug-in reads ids and rooms from the same place as doors.

### Touches

```ts
interface Touch { personId: string; objectId: string; t: number }
```

- **Objects** are furniture (`Room1.Bed.bed`), door handles and the exit keypad, light switches, window handles, equipment (the WC, flush, basin tap, shower, kettle, TV remote), and personal items that go with a resident:
  - their cup, call bell and walking aid;
  - Raj's wheelchair;
  - the hoist, which stays in a bedroom while it's in use.

  Ids are derived from the floor plan and the cards.
- **Who touches what, from each step** (a table in the plan, checked by tests):
  - Morning care: bed rail, the resident's clothes and chair.
  - A drink: the cup.
  - A medication round: the trolley and the cup.
  - The toilet: door handle, light switch, WC, flush, basin tap.
  - A hoist transfer: the hoist and the bed rail.
  - Visitors: the signing-in book, door handles and a chair.
- **About 5,000 touches a day.** They're published in the description as they happen, not logged.

### Weather

```ts
interface Weather { tempC: number; humidityPct: number; dewPointC: number; windMps: number; windDirDeg: number; precipMm: number; cloudPct: number; shortwaveWm2: number; pressureHpa: number; isDay: boolean }
```

- **The most recent complete 12 months of real hourly data for London** (decision 4), from Open-Meteo's historical weather API (ERA5 reanalysis, CC BY 4.0, credited in `CREDITS.md`). It's stored as `data/weather/london.csv` with a JSON header (place, coordinates, period, source, licence).
- **The sim's calendar date picks the hour:** the same month, day and hour in the data's 12 months. Runs longer than a year wrap round. 29 February uses 28 February.
- **The weather file is part of the run's data,** so `dataVersion` covers it and replay is exact.
- **Weather isn't logged** (it's data, like the floor plan); the description carries the current hour.

## Events

Following the naming rule (docs/07), each with a `source` (`engine` for rule changes, or the input's source):

| Event | Payload |
|---|---|
| `door.opened`, `door.closed`, `door.set_ajar`, `door.locked` | {doorId, byId?, reason}: set-state changes only, not passing through |
| `window.opened`, `window.closed` | {windowId, roomId, byId, reason} |
| `equipment.turned_on`, `equipment.turned_off` | {equipmentId, kind, roomId, byId?, level?, reason} |
| `equipment.used` | {equipmentId, kind, byId}: an instant use (a WC flush) |
| `heating.set_point_changed` | {equipmentId, roomId, setpointC, reason} |

Doors and windows add about 195 events a day (PR 1, measured over 8 seeds × 4 weeks) to the 2,400 a calm day logs. The Event log has a **Building** filter for them.

## Browser (docs/08)

- **On the map:**
  - door sprites drawn open, ajar or closed;
  - windows in the walls;
  - a room drawn darker when its lights are off at night;
  - the TV glowing when it's on.
- **In the clock bar:** the weather (temperature, an icon, day or night).
- **In the inspector:** each person's activity, MET and intensity.
- **How it's sent:** the snapshot carries the full description's building part (doors, windows, equipment, weather), and deltas carry its changes. Touches aren't sent to the browser.
- The browser still only draws (rule 3).

## Acceptance

- `pnpm typecheck` and `pnpm test` pass.
- **Behaviour unchanged (decision 2):**
  - every existing golden and director-off fixture matches once the new event types are filtered out and `seq` and `id` are renumbered;
  - a week of each scenario and 8 random-director seeds give the same service-breach results as without the building.
- **Determinism:** two runs of the same seed give identical descriptions on every tick (sampled), and `describe()` called every tick or never leaves the event log unchanged.
- **Rules hold every tick (tests):**
  - a bedroom door is closed during personal care, and a closed door is only `heldBy` someone in its doorway;
  - no window is opened in the rain, the cold or at night, and one open in bad weather is closed as soon as staff are in the room;
  - the TV is on only while someone is watching;
  - lights are off in an empty bedroom;
  - every touch is by someone on the map, in reach of the object (same room, within 1.5 m).
- **Data validated:** windows on outer walls and inside their room's edge; every equipment item in a room; the weather file covers every hour of its year with values in range; every activity has a MET from `activities.json`.
- **Docs updated:**
  - 02 (windows, equipment, door states), 03 (`describe()`), 04 (activities), 07 (events), 08 (protocol and drawing);
  - the constitution's rule 4 already allows this (ADR-0006); CLAUDE.md and the roadmap;
  - `CREDITS.md` for the weather data.
- No attribution anywhere in git or GitHub (constitution rule 7).

## Part 2 sketch: the plug-in API (designed after Part 1)

- **Lockstep:** the server can be asked to wait for each plug-in every step (or every minute), sending the world description and receiving results.
- **Recording:** results come back as inputs with `source: "external"` (for example room conditions, `{roomId, tempC, rhPct, co2Ppm}`), recorded in the `inputs` table, so a run with plug-ins replays exactly without them.
- **Rules that read plug-in results,** such as closing a window when a room is cold, come with it, not before.
- **The airborne proxy** stays until an air plug-in replaces it in the same slot (docs/10).

## Out of scope

- **Any physics:** room temperature, air quality, surface contamination, energy use, sensors. These are plug-ins (rule 4).
- **Behaviour driven by the building:** doors taking time to open, residents asking for windows, staff hand washing at the basin (it needs time and walking). These come later, with the plug-in API's results or a care-routine change.
- **Shower days** (decision 5).
- **LLM minds** (Phase 3).

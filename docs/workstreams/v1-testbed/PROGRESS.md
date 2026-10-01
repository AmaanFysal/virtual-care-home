# Progress: v1.0-testbed

## Done

- **Spec** approved 2026-10-01 (`spec.md`, decisions 1 to 8); plan approved the same day (`plan.md`).
- **PR 1** (merged, #15): people, doors, windows and weather.
  - Engine: `src/building.ts` (the observer, door and window rules), `src/activity.ts` (activity and MET), `src/weather.ts`, `src/describe.ts`; `sim.describe()` and `sim.describeRoom()`; validation of windows, `data/building.json`, `data/activities.json`, night-door reasons and the weather file.
  - Data: 12 windows in `floorplan.json`; `building.json`; `activities.json` (2024 Older Adult and Adult Compendium entries, each with its code); London weather, 8,760 hours from 1 Oct 2025 (`tools/fetch-weather.ts`); `door_at_night` ajar for Stan and Dennis, with reasons.
  - Server and browser: the building in snapshots and deltas, `inspect_room`, activity in the person detail, `START`; door leaves, open windows, the weather in the clock bar, the room inspector, the Building filter.
  - Tests: `building.test.ts`, `describe.test.ts`, new data-validation cases, runner and store tests; the director-off fingerprints unchanged with building events left out.
  - **Checks:** director-off fingerprints unchanged (8 seeds, a week each); random director, 8 seeds × 4 weeks, identical with the building on or off; about 195 building events a day; a mutation check (no door closed for care) is caught by the tests; seen in the browser (morning care, a window aired, the room inspector, night doors).

- **Care perfection removed** (#16, 2026-10-01; main before it tagged `v0.10.0-pre-simplify`): the full scenario audit reverted; the 15 tuning rules and the care-quality tests taken out; from the audit's PR B, the fixes that change who is where kept (U1, U11, U13, U16, U17/R17 and the fuzz finds around them) and the care-quality ones removed (U5, U6, the pre-round hold), docs/12. Director-off fingerprints re-recorded; no hard rule breaks in 8 calm weeks or 32 random-director weeks.
- **PR 2** (merged, #17): equipment and touches; schema 1 complete. Decisions approved at review (project owner, 2026-10-01): keep about 650 touches a day, one per action and only within 1.5 m; the slower runs (about 65% longer with the building) are fine.
  - Engine: `src/equipment.ts` (lights, heating with set points and season, the Lounge TV, the staff-room kettle, WC and basin uses, showers described and off), `src/touches.ts` (the object registry; touches from the tick's events and from steps people start, only within reach; the last 20 by room and person); the weather looked up once an hour.
  - Data: 56 items in `floorplan.json` `equipment` (17 lights, 19 heating, the TV, the kettle, 6 WCs, basins and showers); `building.json` `lights`, `heating` (22 °C day rooms, 21 °C bedrooms and en-suites, October to April), `kettle_mins`.
  - Server and browser: equipment in snapshots and deltas; equipment and recent touches in the room and person inspectors; room lights drawn in the dark, the TV's glow; the map's darkness follows the real daylight.
  - Tests: equipment rules every tick (a November and a May week), the heating season's start and end, `touch.test.ts` (every touch by someone there, on a known object, within reach; a day's volume and kinds), new data-validation, runner and store cases.
  - **Checks:** director-off fingerprints unchanged; random director, 8 seeds × 4 weeks, identical with the building on or off; about 690 building events and 650 touches a day; a mutation check (the TV never switched off) is caught; seen in the browser (the Lounge's equipment and touches at 15:40, lit bedrooms and a dark Lounge at 19:10).

## In progress

- Nothing. The world description (Part 1) is done.

## Next

- Nothing planned in this workstream. **The plug-in API (Part 2) is deferred** (project owner, 2026-10-01): the pipeline uses files, so external models read the activity data from files rather than running in lockstep with the engine. The spec's "Part 2 sketch" stays as the starting point if it's picked up again.

## Blockers

- None.

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-10-01 | Spec, plan and PR 1 | World description with people, doors, windows and weather; behaviour unchanged; PR 1 opened for review |
| 2026-10-01 | PR 2, after #16 | Equipment and touches; schema 1 complete; behaviour unchanged; PR 2 opened for review |
| 2026-10-01 | Review of PR 2 | #17 merged; touch rate and run time approved; the plug-in API deferred (files instead) |

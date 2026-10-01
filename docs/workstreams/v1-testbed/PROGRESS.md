# Progress: v1.0-testbed

## Done

- **Spec** approved 2026-10-01 (`spec.md`, decisions 1 to 8); plan approved the same day (`plan.md`). The full scenario audit is paused after its PR B.
- **PR 1** (branch `v1-testbed`): people, doors, windows and weather.
  - Engine: `src/building.ts` (the observer, door and window rules), `src/activity.ts` (activity and MET), `src/weather.ts`, `src/describe.ts`; `sim.describe()` and `sim.describeRoom()`; validation of windows, `data/building.json`, `data/activities.json`, night-door reasons and the weather file.
  - Data: 12 windows in `floorplan.json`; `building.json`; `activities.json` (2024 Older Adult and Adult Compendium entries, each with its code); London weather, 8,760 hours from 1 Oct 2025 (`tools/fetch-weather.ts`); `door_at_night` ajar for Stan and Dennis, with reasons.
  - Server and browser: the building in snapshots and deltas, `inspect_room`, activity in the person detail, `START`; door leaves, open windows, the weather in the clock bar, the room inspector, the Building filter.
  - Tests: `building.test.ts`, `describe.test.ts`, new data-validation cases, runner and store tests; the director-off fingerprints unchanged with building events left out.
  - **Checks:** director-off fingerprints unchanged (8 seeds, a week each); random director, 8 seeds × 4 weeks, identical with the building on or off; about 195 building events a day; a mutation check (no door closed for care) is caught by the tests; seen in the browser (morning care, a window aired, the room inspector, night doors).

## In progress

- PR 1, in review.

## Next

- PR 2: equipment and touches, after PR 1's review.

## Blockers

- None.

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-10-01 | Spec, plan and PR 1 | World description with people, doors, windows and weather; behaviour unchanged; PR 1 opened for review |

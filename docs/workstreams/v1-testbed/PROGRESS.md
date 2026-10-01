# Progress: v1.0-testbed

## Done

- **Spec** approved 2026-10-01 (`spec.md`, decisions 1 to 8); plan approved the same day (`plan.md`).
- **PR 1** (branch `v1-testbed`): people, doors, windows and weather.
  - Engine: `src/building.ts` (the observer, door and window rules), `src/activity.ts` (activity and MET), `src/weather.ts`, `src/describe.ts`; `sim.describe()` and `sim.describeRoom()`; validation of windows, `data/building.json`, `data/activities.json`, night-door reasons and the weather file.
  - Data: 12 windows in `floorplan.json`; `building.json`; `activities.json` (2024 Older Adult and Adult Compendium entries, each with its code); London weather, 8,760 hours from 1 Oct 2025 (`tools/fetch-weather.ts`); `door_at_night` ajar for Stan and Dennis, with reasons.
  - Server and browser: the building in snapshots and deltas, `inspect_room`, activity in the person detail, `START`; door leaves, open windows, the weather in the clock bar, the room inspector, the Building filter.
  - Tests: `building.test.ts`, `describe.test.ts`, new data-validation cases, runner and store tests; the director-off fingerprints unchanged with building events left out.
  - **Checks:** director-off fingerprints unchanged (8 seeds, a week each); random director, 8 seeds × 4 weeks, identical with the building on or off; about 195 building events a day; a mutation check (no door closed for care) is caught by the tests; seen in the browser (morning care, a window aired, the room inspector, night doors).

## In progress

- PR 1, in review.
- **Care perfection removed** (branch `simplify`, 2026-10-01; main before it tagged `v0.10.0-pre-simplify`): the full scenario audit reverted; the 15 tuning rules and the care-quality tests taken out; from the audit's PR B, the fixes that change who is where kept (U1, U11, U13, U16, U17/R17 and the fuzz finds around them) and the care-quality ones removed (U5, U6, the pre-round hold), docs/12. Director-off fingerprints re-recorded; no hard rule breaks in 8 calm weeks or 32 random-director weeks.

## Next

- PR 2: equipment and touches, after PR 1's review.

## Blockers

- None.

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-10-01 | Spec, plan and PR 1 | World description with people, doors, windows and weather; behaviour unchanged; PR 1 opened for review |

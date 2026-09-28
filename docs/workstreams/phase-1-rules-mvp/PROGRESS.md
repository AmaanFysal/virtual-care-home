# Progress: Phase 1 rules-only MVP

> Updated at the end of every session (see the `pre-pr` skill).

## Status

M0 and M1 done on branch `phase-1-rules-mvp`. **Paused for the user to review the six resident cards before M2.**

## Done

- M0: spec, plan, ADR-0001 (5 s tick), ADR-0002 (SQLite); docs 01, 02, 03, 05, 07 filled; Node pinned to >= 22.13.
- M1: `data/floorplan.json` (6 rooms with floor area and ceiling height, 9 walls, 6 doors, 32 furniture pieces, 46 named points), `data/rota.json`, 6 resident, 10 staff and 25 visitor cards, 18 relationship edges; shared types for data, events, inputs, protocol and sim time; `validateData()` with 9 Vitest tests.

## In progress

- User review of `data/personas/residents.json`.

## Next

- M2: engine core (RNG, clock, input queue, world from data, grid + A* + movement, rota, initial state, headless CLI, determinism test).

## Decisions made (link ADRs)

- All agreed decisions are listed in [spec.md](spec.md); [ADR-0001](../../adr/0001-five-second-tick.md), [ADR-0002](../../adr/0002-sqlite-event-log-phase-1.md).
- En-suite WCs are named points inside each bedroom, not separate rooms (keeps the six agreed spaces).
- Two-person tasks at night (Dennis's and Raj's repositioning) use the off-map second carer.
- Rota rebalanced so nobody works a late then an early (11 hours' rest); Kasia is a meds-trained CA so she can lead lates.

## Blockers and open questions

- Peggy has female carers only for personal care, but the night carer on Sun–Wed (Florin) is male. Proposed: at night her personal care (pad changes) uses the off-map second carer, who is female. To confirm with the user.

## Session log

| Date | Summary | Docs updated |
|------|---------|--------------|
| 2026-09-28 | Agreed spec; M0 docs and ADRs; M1 data, types and validator | spec, plan, 01, 02, 03, 05, 06, 07, ADR-0001, ADR-0002, PROGRESS |

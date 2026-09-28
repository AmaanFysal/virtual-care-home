# Progress: Phase 1 rules-only MVP

> Updated at the end of every session (see the `pre-pr` skill).

## Status

M0 and M1 done on branch `phase-1-rules-mvp`. M0 to M4a done. Next: M4b (morning care, meals, night checks, repositioning, floating night carer).

## Done

- M0: spec, plan, ADR-0001 (5 s tick), ADR-0002 (SQLite); docs 01, 02, 03, 05, 07 filled; Node pinned to >= 22.13.
- M4a: resident needs and sleep, self-toileting, help requests, utility-based task matching (two-person and female-only rules), behaviour-tree runtime, handovers with floor cover and briefing, staggered breaks, staying on until relieved, standing spots, per-tick invariants logged by the engine, inspector detail (needs, workload, BT node). Bank carers Lucy and Shanice replace recurring agency carer slots. 44 tests including a checked week and a throughput budget.
- M3: Fastify/WebSocket server with a 10 Hz pacer, SQLite run log (events, inputs, commands), snapshot on connect and compact deltas; React + Pixi canvas with rooms, walls, furniture, people, smooth interpolation, night dimming and corridor night lights; clock bar. 32 tests.
- Joanne's post moved to a new `Reception.Office` desk; rota rebalanced so Saturday is the only lone agency night (Aisha covers Thu and Fri nights).
- History: all commits reworded to remove AI attribution; `main` force-pushed; commit-msg hook and PR workflow enforce it.
- M2: engine core: sfc32 RNG with per-system streams, 5 s tick clock, input queue (inject_fall recorded), navigation grid with door gaps, deterministic A*, movement with the doorway wait rule, rota with arrivals, agency spawning and RN on-call, Tue 06:00 initial state, headless CLI, 14 engine tests.
- M1: `data/floorplan.json` (6 rooms with floor area and ceiling height, 9 walls, 6 doors, 32 furniture pieces, 46 named points), `data/rota.json`, 6 resident, 10 staff and 25 visitor cards, 18 relationship edges; shared types for data, events, inputs, protocol and sim time; `validateData()` with 9 Vitest tests.

## In progress

- None.

## Next

- M4b: morning personal care, meal service, night checks and repositioning, the floating night carer's rounds and call-outs, check-interval invariant.

## Decisions made (link ADRs)

- All agreed decisions are listed in [spec.md](spec.md); [ADR-0001](../../adr/0001-five-second-tick.md), [ADR-0002](../../adr/0002-sqlite-event-log-phase-1.md).
- En-suite WCs are named points inside each bedroom, not separate rooms (keeps the six agreed spaces).
- Night two-person and same-sex tasks use a floating night carer on planned 2-hourly rounds (spec decision 16).
- Floating night carer (spec decision 16) for Peggy's female-only care and night two-person tasks.
- Carer breaks need another carer (not the RN) on the floor.
- Bank carers cover recurring gaps; the rota also fixes Friday late having no female carer.
- Web draws with plain Pixi from a React ref, not `@pixi/react` (planned fallback; see 08).
- Doorway zones stay closed for the rest of the tick in which they were used (no crossing within 5 s).
- Rota rebalanced so nobody works a late then an early (11 hours' rest); Kasia is a meds-trained CA so she can lead lates.

## Blockers and open questions

- Known M4a gap, fixed in M4b: at night Raj's two-person pad change and Peggy's female-only care wait until morning when the night carer is male (the floating night carer isn't built yet). Worst wait in a week: about 10 hours.
- Without meals (M4b), hunger and thirst drive most help requests (~100 a day).


## Session log

| Date | Summary | Docs updated |
|------|---------|--------------|
| 2026-09-28 | Agreed spec; M0 docs and ADRs; M1 data, types and validator | spec, plan, 01, 02, 03, 05, 06, 07, ADR-0001, ADR-0002, PROGRESS |
| 2026-09-28 | Attribution guard and history cleanup; floating night carer decision; M2 engine core | spec, 02, 03, 04, 05, 07, 11, CLAUDE.md, PROGRESS |
| 2026-09-28 | Reception office, rota rebalance (one agency night), M3 server and canvas | 01, 02, 03, 05, 08, CLAUDE.md, PROGRESS |
| 2026-09-28 | Bank carers; M4a needs, tasks, BT runtime, handovers, breaks, standing spots, invariants, throughput test | 04, 05, 06, 07, 11, spec, PROGRESS |

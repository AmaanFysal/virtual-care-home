# Progress: Phase 1 rules-only MVP

> Updated at the end of every session (see the `pre-pr` skill).

## Status

M0 and M1 done on branch `phase-1-rules-mvp`. **Phase 1 built (M0 to M7).** Acceptance passes except one visitor criterion on one seed (below). Next: the user's review; then Phase 2 (minds).

## Done

- M0: spec, plan, ADR-0001 (5 s tick), ADR-0002 (SQLite); docs 01, 02, 03, 05, 07 filled; Node pinned to >= 22.13.
- M6: visitors: daily sampling from patterns (seeded), companions with their lead, sign-in with the receptionist or a carer answering the bell out of hours, visits beside the resident, protected lunch and personal-care friction (Kuldip may help Raj at lunch), sign-out and leaving, none for residents in hospital; visitor numbers in `--report`. 85 tests. Stress re-run: 65 fall runs 0 hard / 1 service breach; 8 no-fall weeks 0 / 0.
- M5 review: on-call RN comes over for serious falls with no RN on the wing; invariants split into hard safety rules (`invariant.violated`, must be zero) and service targets (`sla.breached` with cause, reported). 65 fall runs: 0 hard, 1 service breach; 8 no-fall weeks: 0 and 0.
- M5: medication rounds (RN 08:00/13:00/17:00, late lead 21:00; interruptible, missed-dose chance rising with interruptions, late after 60 min), fall response by day (RN attends) and night (on-call RN by phone, floating carer lifts or covers), paramedics and conveyance to hospital with CQC flag, family and incident logging, post-fall checks; `meds_trained` and `fall_moved_before_assessment` invariants; golden tests; inject-fall buttons and "in hospital" bed label in the browser. 77 tests.
- M4b: care schedule (morning and bedtime care, three meals with intake charting, drinks rounds at 10:30/15:00/20:00, Peggy's prompted toileting, checks with observation, Dennis's 2-hourly turns with fluids and mouth care), floating night carer rounds and call-outs, wait-time rule, `resident_check` and `request_wait` invariants, `--report`. About 13 requests a day (~48% toileting), longest wait 21 min, zero violations over a week on 8 seeds. 58 tests.
- M4a: resident needs and sleep, self-toileting, help requests, utility-based task matching (two-person and female-only rules), behaviour-tree runtime, handovers with floor cover and briefing, staggered breaks, staying on until relieved, standing spots, per-tick invariants logged by the engine, inspector detail (needs, workload, BT node). Bank carers Lucy and Shanice replace recurring agency carer slots. 44 tests including a checked week and a throughput budget.
- M3: Fastify/WebSocket server with a 10 Hz pacer, SQLite run log (events, inputs, commands), snapshot on connect and compact deltas; React + Pixi canvas with rooms, walls, furniture, people, smooth interpolation, night dimming and corridor night lights; clock bar. 32 tests.
- Joanne's post moved to a new `Reception.Office` desk; rota rebalanced so Saturday is the only lone agency night (Aisha covers Thu and Fri nights).
- History: all commits reworded to remove AI attribution; `main` force-pushed; commit-msg hook and PR workflow enforce it.
- M2: engine core: sfc32 RNG with per-system streams, 5 s tick clock, input queue (inject_fall recorded), navigation grid with door gaps, deterministic A*, movement with the doorway wait rule, rota with arrivals, agency spawning and RN on-call, Tue 06:00 initial state, headless CLI, 14 engine tests.
- M1: `data/floorplan.json` (6 rooms with floor area and ceiling height, 9 walls, 6 doors, 32 furniture pieces, 46 named points), `data/rota.json`, 6 resident, 10 staff and 25 visitor cards, 18 relationship edges; shared types for data, events, inputs, protocol and sim time; `validateData()` with 9 Vitest tests.

## In progress

- None.

## Next

- User review of Phase 1; decision on the visitor criterion; then Phase 2 planning.

## Decisions made (link ADRs)

- All agreed decisions are listed in [spec.md](spec.md); [ADR-0001](../../adr/0001-five-second-tick.md), [ADR-0002](../../adr/0002-sqlite-event-log-phase-1.md).
- En-suite WCs are named points inside each bedroom, not separate rooms (keeps the six agreed spaces).
- Night two-person and same-sex tasks use a floating night carer on planned 2-hourly rounds (spec decision 16).
- Floating night carer (spec decision 16) for Peggy's female-only care and night two-person tasks.
- Checks: by day observation within 6 m counts; at night and always for Dennis only bedside checks (1.5 m), logged with `via`. Checks before handover at 06:40 and 20:55.
- M7 (part 2): inspector (needs, workload, task and BT step, persona facts, schedule, recent events, inject fall), follow camera with zoom, filtered event log panel, `?select=` links; acceptance test. Requests: 7.6 to 9.0 a day across seeds 1 to 8, toileting 65 to 75%, social 0%; longest single wait 24 min. 98 tests + 1 expected failure.
- M7 (part 1): idle behaviour (care notes, tidying, restocking, sitting with residents who want company), interruptible, on the floor; holders wait in the corridor. Social requests down to ~0. Breaks guard waiting two-person tasks. Stress: no-fall 0/0, falls 0 hard / 3 service.
- Visitor acceptance restated (user): weekday peak avg 2 to 4, Sunday avg 4 to 8, everyone but Arthur 2+ visits a week.
- Repositioning is a service target (2 h, counted from the start of a turn). Evening turns due 20:00 to 21:00 move to 19:45; the floating carer's rounds follow Dennis's turns from 21:00 to 08:00 (she arrives 30 min early and batches Raj); day breaks wait for a nearly-due two-person turn; the handover floor cover keeps working past shift end. 8 no-fall weeks: 0 hard, 0 service.
- M5 fixes found by the stress runs: late shift floor cover stays until its handover ends; a briefing no longer holds someone idle; a check can't absorb a two-person request; staff go to where the resident is (chair or floor), not always the bed; check lead capped at half the interval (post-fall checks); two-person morning care waits for the day shift.
- Handover fix: outgoing staff can still join their handover after shift end and don't leave owing it; handovers go ahead after 30 min with whoever is there.
- Scheduled care takes over a waiting request; only one two-person task may be held by a lone carer at a time (deadlock fix).
- Carer breaks need another carer (not the RN) on the floor.
- Bank carers cover recurring gaps; the rota also fixes Friday late having no female carer.
- Web draws with plain Pixi from a React ref, not `@pixi/react` (planned fallback; see 08).
- Doorway zones stay closed for the rest of the tick in which they were used (no crossing within 5 s).
- Rota rebalanced so nobody works a late then an early (11 hours' rest); Kasia is a meds-trained CA so she can lead lates.

## Blockers and open questions

- **Visitor criterion "everyone but Arthur gets 2+ visits a week, across seeds 1 to 8":** holds on seeds 1 to 7 and on average, but on seed 8 Linda misses four of her five days (each 85% likely), so Peggy gets 1 visit. Options: judge the criterion on the average across seeds; model reliability as a weekly quota rather than independent days; or accept seed 8 as a rare bad week. Marked `it.fails` in the acceptance test until decided.


## Session log

| Date | Summary | Docs updated |
|------|---------|--------------|
| 2026-09-28 | Agreed spec; M0 docs and ADRs; M1 data, types and validator | spec, plan, 01, 02, 03, 05, 06, 07, ADR-0001, ADR-0002, PROGRESS |
| 2026-09-28 | Attribution guard and history cleanup; floating night carer decision; M2 engine core | spec, 02, 03, 04, 05, 07, 11, CLAUDE.md, PROGRESS |
| 2026-09-28 | Reception office, rota rebalance (one agency night), M3 server and canvas | 01, 02, 03, 05, 08, CLAUDE.md, PROGRESS |
| 2026-09-28 | Bank carers; M4a needs, tasks, BT runtime, handovers, breaks, standing spots, invariants, throughput test | 04, 05, 06, 07, 11, spec, PROGRESS |
| 2026-09-28 | M4b care schedule, drinks rounds, floating night carer, wait-time rule, check invariant, request report | spec, 04, 05, 07, 11, CLAUDE.md, PROGRESS |
| 2026-09-28 | M4b review: bedside-only checks at night and for Dennis, handover rounds, handover deadlock fix, need-rate tuning record, float time-on-site report | spec, 04, 05, PROGRESS |
| 2026-09-28 | M5 med rounds, falls, paramedics, golden tests; stress runs and fixes | spec, 04, 05, 07, 11, 12, PROGRESS |
| 2026-09-28 | M5 review: on-call RN for serious night falls; hard invariants vs service targets | spec, 05, 07, 11, 12, PROGRESS |
| 2026-09-28 | M6 visitors; overdue-turn escalation; visitor stats in report | 05, 06, 07, 11, PROGRESS |
| 2026-09-28 | Turning as a service target; evening crunch and night rounds fixed; visitor target restated | spec, 05, 11, PROGRESS |
| 2026-09-28 | M7 part 1: idle behaviour; break guard for waiting two-person tasks | 04, 11, PROGRESS |
| 2026-09-28 | M7 part 2: inspector, follow, event log panel, acceptance test | 08, 11, spec, plan, PROGRESS |

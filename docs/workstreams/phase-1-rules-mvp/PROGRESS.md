# Progress: Phase 1 rules-only MVP

> Updated at the end of every session (see the `pre-pr` skill).

## Status

M0 and M1 done on branch `phase-1-rules-mvp`. **Phase 1 complete (2026-09-29).** All acceptance criteria pass on seeds 1 to 8; PR open into `main`, pending the user's manual 10x check. **M8 (behaviour audit fixes and the Lounge) done the same day**, on the same branch. Next: Phase 2 (minds).

## Done

- M8: behaviour audit (`sim --audit`, thresholds in `scripts/audit.config.ts`). Also:
  - The Lounge: room, furniture, residents' routine, Bev's sessions, dozing, visitors, and the `lounge_supervision` service target.
  - Every room change logged.
  - Audit fixes A to G:
    - morning: tea on waking, breakfast from 07:30, and the nurse kept free for the 08:00 round, which gives time-critical meds first
    - Dennis's comfort care
    - a supper snack
    - reserved two-person tasks (ADR-0003)
    - left drinks
    - requests absorbed during care
  - Audit flags on seeds 1 to 8: 1,378 before, 304 after.
  - 118 tests. 8 no-fall weeks: 0 hard / 0 service. 120 fall runs: 0 hard / 20 service (7 before on the same set).
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

- User's manual 10x check and merge; then Phase 2 planning (docs/09).

## Decisions made (link ADRs)

- Occasional service breaches on normal days are acceptable and reported; no new special-case scheduling rules just to reach zero (user, 2026-09-29). Week tests allow up to 2 per no-fall week. Dennis's wash is after the 08:00 round (08:30).
- All agreed decisions are listed in [spec.md](spec.md); [ADR-0001](../../adr/0001-five-second-tick.md), [ADR-0002](../../adr/0002-sqlite-event-log-phase-1.md).
- En-suite WCs are named points inside each bedroom, not separate rooms (keeps the six agreed spaces).
- Night two-person and same-sex tasks use a floating night carer on planned 2-hourly rounds (spec decision 16).
- Floating night carer (spec decision 16) for Peggy's female-only care and night two-person tasks.
- Checks: by day observation within 6 m counts; at night and always for Dennis only bedside checks (1.5 m), logged with `via`. Checks before handover at 06:40 and 20:55.
- Weekly visitor quota (user decision): quota of pattern days per week from reliability, days by seeded shuffle; acceptance passes on all 8 seeds; director week-cancelling noted for Phase 3 (docs/10).
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

- Remaining audit flags (user to decide):
  - First food is over 60 minutes after waking for Win, Peggy and Arthur on most mornings.
- 2 service breaches in 56 no-fall days (evening toilet requests). Accepted as realistic (user decision); the week tests allow up to 2 per week.
- Fall runs breach more service targets than before (20 against 7). Falls now land in busier spells.
- Tuning debt: the special-case scheduling rules listed in docs/12, to revisit with the scenario director.
- None blocking. Note: the Sunday visitor peak averages 4.00, exactly the lower edge of its 4 to 8 target; a small data change would move it.
- Manual check before merge (user): 30 sim minutes at 10x around 07:30 and 15:00.


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
| 2026-09-29 | Weekly visitor quota; acceptance passes on seeds 1 to 8; Phase 1 complete; PR opened | 05, 06, 10, 11, PROGRESS |
| 2026-09-29 | Behaviour audit command; Lounge room and routine; `lounge_supervision` target; audit fixes (tea on waking, breakfast 07:30, nurse and 08:00 round, Dennis comfort care, supper snack, reserved two-person tasks, left drinks, requests during care); every room change logged | spec, plan, 02, 04, 05, 07, 11, ADR-0003, CLAUDE.md, PROGRESS |
| 2026-09-29 | Audit: first food within 60 min (not breakfast); Dennis's wash at 08:30; week tests allow up to 2 reported breaches; tuning debt listed | 05, 11, 12, PROGRESS |
| 2026-09-29 | RN does no resident care from 07:45 until the 08:00 round is done; audit judges Dennis's sips by his comfort interval; PR description updated | 04, 05, 11, 12, PROGRESS |
| 2026-09-29 | Branch `visuals-pixel-art`: LPC character sprites; pixel-art map from the floor plan (banded wall faces, manifest-driven tiles, render-only decor and garden, name tags, night lamps); ADR-0004 replaces constitution rule 6; bedside chairs face the camera; ADR-0003 deciders fixed and a docs attribution check added to the no-AI-attribution Action and pre-pr | 00, 08, ADR-0003, ADR-0004, .claude/rules/web.md, .claude/skills/pre-pr, CLAUDE.md, CREDITS.md, PROGRESS |
| 2026-09-29 | Branch `fix-movement-and-breaks`: staff stand beside the WC (standing points), sit only in the staff room and at reception; the server sends turning points (`via`) so the browser never draws a move through a wall; every break in the staff room, and the lone night carer's break taken during the floating carer's round after its two-person work, with her covering the wing. Audit seeds 1-8: 162 flags (166 before), 0 service breaches (2 before); floating carer 24-33% of full nights | 02, 04, 05, 08, 11, PROGRESS |
| 2026-09-29 | Carers sitting with a resident sit in a free seat within 2 m (bedside chair, Lounge seats, dining chairs), otherwise stand; WC seats stay residents-only; Lounge seats kept free for residents. Audit unchanged: 162 flags, 0 service breaches | 02, 04, 11, PROGRESS |
| 2026-09-29 | Branch `bedside-chairs`: bedside chairs only for residents who sit out (Peggy, Win, Arthur, Stan); Raj has a wheelchair spot (`Room2.BedB.Wheelchair`, new point kind `wheelchair`) with clear floor for the hoist; Dennis none; validator checks it. Audit and reports on seeds 1-8 identical to main | 02, 04, 05, 08, 11, PROGRESS |
| 2026-09-30 | Branch `single-rooms`: six single 4 m en-suite bedrooms (walled en-suites as rooms inside bedrooms; beds centred with 1.5 m clear both sides; en-suite doors 0.9 m clear), a bigger Lounge (52 m²), a second waiting-area door into reception, rooms allocated by need (Peggy and Stan by the staff room); validator rules for single rooms, nested en-suites, bed clearance, door clear width and touching doorways (a doorway deadlock found and fixed). Audit seeds 1-8: 142 flags (162 on main), 2 service breaches in 56 days (0 on main), 0 hard violations | 02, 05, 06, 08, 11, CLAUDE.md, PROGRESS |
| 2026-09-30 | Branch `fix-overlapping-falls`: several falls at once. A fall takes the nearest carer whose work can wait (never from another fall, a two-person transfer or a walking resident); a fall nobody can reach asks for help (floating carer, then on-call RN at night) and goes to the next person free, every tick; lifts pair up when everyone is with a fallen resident; nothing about a fallen resident changes until moved; new hard invariant `fall_unattended` and service target `fall_attendance`. The same pattern fixed in the 21:00 med round, paramedic calls and residents' own walks, and a cut-short day break now waits for floor cover. No-fall weeks byte-identical to main; 20 three-fall runs: 0 hard, everyone seen to (40 of 60 abandoned before) | 04, 05, 07, 11, 12, PROGRESS |

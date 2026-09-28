# 11 · Testing

**Purpose:** how we prove the sim is correct and reproducible: unit tests, invariants, golden scenario tests, determinism checks, and (later) LLM evals.

> Status: partly decided (M2). Source: [plan-v2](research/plan-v2.md) (Testability), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §4.

Tooling: Vitest (`pnpm test`), TypeScript (`pnpm typecheck`).

## To be decided

- The invariant set and where it runs. Candidates: at least one staff member on the floor; no resident unchecked beyond their care-plan interval; no two-person transfer done by one; visitors never in the staff room.
- Golden scenario test format (e.g. fall at 06:40 → RN attends within 10 sim minutes, not moved before assessment, family called, incident logged).
- Determinism test: same seed + inputs → identical event log hash.
- Headless soak runs (N sim days) and what they assert.
- Guard checks for the constitution (no `Math.random` / `Date.now` in sim-engine; web doesn't import sim-engine).
- LLM evals (Phase 2) and CI provider.

## Tests so far

| File | Covers |
|---|---|
| `packages/sim-engine/test/data.test.ts` | Data validator on the real files, plus injected errors it must catch |
| `packages/sim-engine/test/engine.test.ts` | RNG reproducibility and stream independence; byte-identical logs for the same seed and inputs; different seed differs; gap-free seq and ids; every point reachable; paths use doors not walls; doorway single occupancy (targeted crossing and a 5-day run); nobody off walkable ground or faster than their speed; rota events for Tuesday; agency spawning and clean-up || `packages/sim-engine/test/behaviour.test.ts` | Behaviour-tree runtime; standing spots; **a full week with every invariant checked every tick** (floor cover, standing spots, two-person care, RN reachable, no visitors in the staff room); three handovers a day with the expected people and floor cover, and the 07:00 briefing; one break each, carers never off together, sole night carer breaks in the wing; help requests served (two staff for Raj, only women for Peggy's personal care); staff stay on until relieved; **throughput: one headless sim day within 2,000 ms** (`VCH_DAY_BUDGET_MS` to override) |
| `packages/sim-engine/test/care.test.ts` | The care day: morning care for all by 10:30 and up to the chair (Raj by hoist, two staff); three meals each and intake charted; drinks rounds at 10:30, 15:00, 20:00; everyone back to bed; Dennis turned at least every 2.5 h by two staff; night checks; the floating carer on all five rounds, turning Raj at 22:00 and 02:00; only women do Peggy's personal care; under 40 requests a day, mostly toileting; a forced call-out and a wait-for-the-round case; seeds 2, 3 and 4 run a week with no violations (deadlock guard) |
| `packages/sim-engine/test/golden.test.ts` | **Golden fall scenarios**: day minor (RN at her side within 10 min, assessed before any move, two-person lift, family phoned, incident, 4 h of 30-minute checks) and day serious (999, the carer stays, paramedics in 30 to 90 min, hospital, CQC Reg 18 flag, bed shows "in hospital"); night minor at 06:40 and 02:00 (on-call RN by phone in 3 to 5 min, floating carer helps lift, back to bed) and night serious (floating carer covers the wing while the carer waits); six more resident/time/severity cases on three seeds with zero violations. Every scenario checks the resident is on the floor on every tick until assessed. **Medication rounds**: four a day with the right givers, 24 doses, only meds-trained staff, no missed doses without interruptions, a fall pauses and resumes the round, heavy interruption causes missed doses |
| `packages/sim-engine/test/visitors.test.ts` | Visits planned only on listed days within the arrival window; companions only with their lead; sign-in with Sanjay in office hours and a carer letting people in otherwise; protected lunch kept (only a meal helper starts a visit then); every visit ends with signing out and leaving; Kuldip helps Raj eat; no visitors for a resident in hospital |
| `packages/sim-engine/test/idle.test.ts` | Idle activities fill free time (over 20% of carer minutes; all four kinds occur; always on the floor); corridor standing under 5%; a help request takes someone off an idle activity within a minute; at most 2 requests for company a week |
| `packages/sim-engine/test/acceptance.test.ts` | **Phase 1 acceptance** (spec): one day on seed 1 with zero hard violations and zero service breaches, three handovers with the floor covered, four med rounds (21:00 by a meds-trained carer, 24 doses), three meals and morning care for everyone, Raj always moved by two staff, night checks for everyone, a byte-identical log on a second run; visitors across seeds 1 to 8 (weekday peak average 2 to 4, Sunday 4 to 8, everyone but Arthur at least 2 visits a week: holds on seeds 1 to 7 and on average; seed 8 gives Peggy 1, marked as an expected failure pending a decision) |
| `apps/server/test/runner.test.ts` | Snapshot on connect, pacing, compact deltas, SQLite logging, input logging before apply, command parsing, inspect detail |
| `apps/web/test/store.test.ts` | Store folding of snapshot and deltas, night dimming curve |

## Invariants and service targets (`packages/sim-engine/src/invariants.ts`)

- **Hard safety invariants** (`checkInvariants`, event `invariant.violated`): `floor_cover`, `standing_spot`, `two_person`, `rn_reachable`, `no_visitors_in_staff_room`, `meds_trained`, `fall_moved_before_assessment`. Must be zero in every run, including fall runs.
- **Service targets** (`checkServiceTargets`, event `sla.breached` with a cause from `breachCause`: "during/after <severity> fall (<name>)", "during post-fall observations (<name>)" or "no emergency"): `request_wait`, `resident_check`, `reposition`. Must be zero on days without a fall; fall runs may breach them but every breach is reported.

The headless CLI's `--report` prints help requests per care day by need, the longest wait per resident, floating-carer time on site per night, hard violations, and service breaches grouped by target and cause.

## Stress runs (after the M5 review)

65 headless fall runs (13 scenarios × 5 seeds, 48 hours each) and 8 no-fall weeks:

| | Hard violations | Service breaches |
|---|---|---|
| 65 fall runs | 0 | 1 (Dennis's hourly check 3 minutes late, during Win's serious fall at 08:10, seed 4) |
| 8 no-fall weeks | 0 | 0 |

With the on-call RN coming over for serious night falls, the four night-time request waits seen after M5 no longer happen. Re-run with visitors (M6): the same result, 0 hard and 1 service breach in fall runs, 0 and 0 in no-fall weeks.

After making repositioning a service target and fixing the evening crunch (M6 review): 8 no-fall weeks 0 hard / 0 service; 65 fall runs 0 hard / 5 service (4 turns delayed during a serious fall or post-fall observations, 1 post-fall check 20 seconds late after Arthur's evening fall).

With idle behaviour (M7): 8 no-fall weeks 0 hard / 0 service; 65 fall runs 0 hard / 3 service (post-fall checks after Arthur's and Win's evening falls). Requests average 7.6 to 9.0 a day across seeds 1 to 8; toileting 65 to 75%, hunger about 20%, thirst 4 to 16%, social 0%.


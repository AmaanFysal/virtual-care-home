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
| `apps/server/test/runner.test.ts` | Snapshot on connect, pacing, compact deltas, SQLite logging, input logging before apply, command parsing, inspect detail |
| `apps/web/test/store.test.ts` | Store folding of snapshot and deltas, night dimming curve |

## Invariants implemented (`packages/sim-engine/src/invariants.ts`)

`floor_cover`, `standing_spot`, `two_person`, `rn_reachable`, `no_visitors_in_staff_room`, `resident_check` (per resident), `request_wait` (per request). The engine logs `invariant.violated` once when a rule starts failing (per resident or request for the keyed rules). Still to come: meds-trained only and no fallen resident moved before assessment (M5).

The headless CLI's `--report` flag prints help requests per care day by need, the longest wait per resident, floating-carer visits and call-outs, and the violation count.


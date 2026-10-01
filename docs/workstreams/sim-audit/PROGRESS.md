# Progress: the full scenario audit

> Updated at the end of every session (see the `pre-pr` skill).

## Status

**PR A merged** (#13). **PR B in review** (2026-10-01): the engine bugs. PRs C to F follow ([plan.md](plan.md)), each stopping for review.

## Done

- **The audit** ([report.md](report.md)): a feature inventory (24 features), the interaction review (276 pairs, 68 with a gap), a safety monitor checked every tick, 3,000 fuzz cases across 40 seeds, and a realism review. 45 gaps: 19 unsafe, 19 unrealistic, 7 cosmetic; the 34 a rule can catch each have a named scenario that runs as a test.
- **Decisions** recorded in [spec.md](spec.md) and ADR-0007.
- **PR A** (branch `sim-audit`, no behaviour change):
  - `packages/sim-engine/src/safety.ts`: the safety monitor (52 rules), not wired into `sim.ts`; visitor limit 2 (decision 1); new rules for escorts walking apart (U16) and hoisted residents sitting out over 6 hours (U19).
  - `scripts/fuzz.ts` and `scripts/fuzz-lib.ts`: the fuzz runner (`pnpm --filter @vch/sim-engine fuzz`), split so tests can use it; `--dump` and `--replay`.
  - `cases/`: 31 named cases, one or more per detectable gap, with the rules each breaks and the PR that fixes it.
  - `test/audit.test.ts`: the monitor only watches (a day with it on is byte-identical); fuzz cases regenerate identically and validate; every named case still breaks its rules.
  - Docs: docs/05 (what isn't modelled yet), docs/11, docs/12, the roadmap, CLAUDE.md.
  - **Checks:** `pnpm typecheck` clean; `pnpm test` 306 passed (the 272 before, plus 34 audit tests); no clock, randomness or I/O in `packages/sim-engine/src`; no attribution in docs.
  - **Fuzz re-run** for PR A (3,000 cases, 40 seeds, 15,496 days): 0 crashes, 0 hangs; the same gaps as the report, with `isolated_visitors_over_limit` at 139 cases at the limit of 2 (174 at 1). The two new rules fire every calm day (baseline).

- **PR B** (branch `sim-audit-b`): U1 (a fall while an ambulance is coming: one call, taken from the floor), U5 (doses delayed by a fall recorded and given later, `med.delayed`), U6 (time-critical doses within 30 minutes), U11 (staff taken ill stop care and leave once it's safe; symptoms on arrival send them home), U13 (visitors wait by the bed), U16 (escorts walk beside the resident on the resident's route, `Move.tether`), U17 and R17 (999 at once for a serious fall, the nurse hands over the wait, a crew per call).
  - Also fixed, found while building it: a night bridge taken ill no longer double-books cover; a handover's floor cover taken ill is replaced (before it starts or while the others gather); a round isn't handed to a carer who may not be meds-trained; a resident admitted during a round joins it.
  - Tests: `test/audit-b.test.ts` (9); named cases flipped to fixed, plus `night-bridge-ill.json` and `handover-cover-ill.json`; `isolated-left-room.json` moved to seed 1 (escort timing changed); the golden night-fall test expects 999 at the find; the director-off fixture re-recorded on purpose.
  - Fuzz (3,000 cases, before the last four fixes): 0 crashes, 0 hangs; `long_lie`, `stuck_external`, `sick_staff_on_wing`, `visitor_in_ensuite` 0; the rest in report.md section 4. Calm weeks: 0 breaches, 0 hard violations, 146 audit flags (153 on main).

## In progress

- PR B, in review.

## Next

- PR C (staffing escalation), after PR B's review.

## Blockers

- None. To confirm at PR B's review: where U20 and R20 go (found while building PR B, logged in report.md; C proposed).

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-10-01 | The audit and PR A: tooling, report, named cases as tests, decisions recorded (ADR-0007) | 45 gaps (19 unsafe), 31 named cases as tests, 306 tests pass; PR A opened for review |
| 2026-10-01 | PR B: the engine bugs | 8 gaps fixed, 4 more found in its fuzz run fixed, 2 logged for later (U20, R20); 317 tests; PR B opened for review |

# Progress: the full scenario audit

> Updated at the end of every session (see the `pre-pr` skill).

## Status

**PR A in review** (2026-10-01): the audit tooling and report. Fixes follow in PRs B to F ([plan.md](plan.md)), each stopping for review.

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

## In progress

- PR A, in review.

## Next

- **PR B:** the engine bugs (U1, U5, U11, U17, escorts and en-suite visitors; U6 and R17 proposed).

## Blockers

- None. To confirm at PR A's review: the placement of the gaps marked * in plan.md.

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-10-01 | The audit and PR A: tooling, report, named cases as tests, decisions recorded (ADR-0007) | 45 gaps (19 unsafe), 31 named cases as tests, 306 tests pass; PR A opened for review |

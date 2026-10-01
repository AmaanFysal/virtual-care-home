# Workstream spec: the full scenario audit

**Goal:** make the simulation safe and realistic where its features combine, before the v1.0-testbed is built on it. The audit found the gaps; this workstream fixes them one reviewed PR at a time.

Source: [report.md](report.md) (the audit: inventory, interaction review, invariants, fuzz runner, realism review, 45 gaps with a scenario for each), [ADR-0007](../../adr/0007-care-policy-decisions-from-the-full-scenario-audit.md) (the care-policy decisions below). Constraints: [00-constitution](../../00-constitution.md).
Status: **agreed 2026-10-01.** Tasks and the order of PRs are in [plan.md](plan.md).

## In scope

- **PR A:** the audit tooling and report (the safety monitor, the fuzz runner, the named cases as tests). No behaviour change.
- **PRs B to F:** the fixes, in the order in plan.md, each with its named cases flipped from "fails" to "passes".
- **Wiring the safety monitor into the engine** (decision 6), once each gap is fixed or accepted.

## Decisions (project owner, 2026-10-01)

These replace any earlier ones.

1. **Visiting** follows UKHSA's 2024 guidance.
   - Visits continue with precautions; residents who are isolating are visited in their room.
   - Restrictions only when the health protection team advises (a scenario option), and time-limited.
   - End-of-life visits are always facilitated.
   - An isolated resident has up to 2 visitors at a time: a setting in `data/director.json`, read by the monitor (`ECS_LIMIT`, 2 from PR A).
2. **End of life and hospital.**
   - Each resident card gets an advance care plan field: hospital transfer `yes`, `no` or `comfort_only`.
   - A planned decline sets `comfort_only`: no transfer except for comfort (for example a hip fracture).
   - A pending ambulance is cancelled when the decline begins, unless it's for comfort.
   - A death due while the resident is in hospital happens in hospital, and the family is informed.
3. **Same-sex care.**
   - A turn with a pad change is female-only care for a resident with female carers only.
   - When no woman is on shift: keep the last woman on (within rest limits); then book a female agency worker; then call a female carer from the main building; at night, Lorna.
   - After a serious fall, Peggy needs two staff with at least one woman, who does the personal care.
4. **A lone carer by day.**
   - The wing can ask the main building for help by day, as at night.
   - The night carer owns any overdue evening turn from the handover, and the handover notes list overdue tasks.
   - A reservation with no available partner is released after a short time, with help requested.
5. **Card items.**
   - Model now: diet texture (an IDDSI level on each card; Raj level 6), fluid limits (Win 1,500 ml) and Win's glucose check.
   - Arthur's independence and Stan's night wandering go in the realism batch (PR F); docs/05 notes them as not yet modelled.
6. **The safety monitor becomes engine invariants** once each gap is fixed or accepted: safety rules as hard invariants, timing rules as service targets. The director-off fixture is re-recorded when that happens.
7. **One PR each, in order, stopping after each for review:** A (tooling and report), B (engine bugs), C (staffing escalation), D (card items), E (visiting, outbreaks, end of life and admissions), F (remaining unrealistic and cosmetic gaps, then the monitor wired in).

## Acceptance for each PR

- `pnpm typecheck` and `pnpm test` pass.
- The PR's named cases (`cases/*.json`, `audit.fixIn`) flip to `"expect": "passes"` and pass; every other case still behaves as recorded.
- The fuzz runner is re-run (3,000 cases): no crashes or hangs, and the PR's rules no longer fail beyond the calm baselines. The report's numbers are updated.
- 0 hard violations in every run; service breaches reported with causes.
- No special-case rules: fixes are general rules (the tuning-debt decision, docs/12).
- The director-off fixture changes only on purpose, re-recorded with the reason in the commit.
- No attribution anywhere in git or GitHub (constitution rule 7).

## Out of scope

- The v1.0-testbed (next, docs/roadmap.md).
- The care routine review for the tuning review's audit regressions (docs/12): after the test bed.
- LLM minds (Phase 3).

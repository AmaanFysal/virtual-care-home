# ADR 0007: Care-policy decisions from the full scenario audit

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Amaan (project owner)
- **Affected docs:** docs/05-care-operations.md, docs/06-personas-and-families.md, docs/10-director-and-scenarios.md, docs/11-testing.md, docs/12-risks-and-debt.md, ADR-0003 (to be amended in PR C)

## Context

The full scenario audit (docs/workstreams/sim-audit/report.md) ran 3,000 random combinations of director events with 50 safety, care-plan and integrity rules checked every tick. The engine held together (no crashes, nobody inside a wall, no medication from untrained staff), but it found 45 gaps where features combine, 19 of them unsafe. Several come from policies the engine encodes rather than from bugs:

- **Visiting during outbreaks** is a blanket ban except for Dennis. UKHSA's 2024 guidance (*Supporting safer visiting in care homes during infectious illness outbreaks*) says there should not normally be any restrictions, that restrictions must be exceptional, proportionate and time-limited, and that end-of-life visits continue even then. Regulation 9A protects visiting. An isolated resident outside an outbreak, meanwhile, has no limit at all.
- **End of life and hospital:** a planned decline doesn't stop an ambulance already called, a serious fall in the last days goes to 999, and a death due in hospital waits until the resident is back.
- **Same-sex care:** cover ignores gender, nothing escalates female-only care by day, and turns with a pad change aren't female-only.
- **A lone carer** can't get help for two-person care by day, a reservation with no partner never lapses, and nobody owns an evening turn missed before the night shift.
- **Card items** (diet texture, fluid limits, Win's glucose check) are documented but not modelled.
- **The new rules** run only in the audit tooling, not in the engine.

## Decision

We will:

1. **Follow UKHSA's 2024 visiting guidance.** Visits continue with precautions; isolating residents are visited in their room, up to 2 visitors at a time (a setting in `data/director.json`); restrictions only when the health protection team advises (a scenario option), time-limited; end-of-life visits always.
2. **Add an advance care plan to each resident card**: hospital transfer `yes`, `no` or `comfort_only`. A planned decline sets `comfort_only` (no transfer except for comfort, for example a hip fracture) and cancels a pending ambulance unless it's for comfort. A death due in hospital happens in hospital, with the family informed.
3. **Treat a turn with a pad change as female-only care**, and escalate when no woman is on shift: keep the last woman on (within rest limits), then a female agency worker, then a female carer from the main building; at night, Lorna. After a serious fall, Peggy needs two staff with at least one woman, who does the personal care.
4. **Let the wing ask the main building for help by day**, as at night. The night carer owns any overdue evening turn from the handover, and handover notes list overdue tasks. A reservation with no available partner is released after a short time, with help requested (amends ADR-0003).
5. **Model diet texture** (an IDDSI level per card), **fluid limits** and **Win's glucose check** now; Arthur's independence and Stan's night wandering later, noted in docs/05 as not yet modelled.
6. **Wire the safety monitor into the engine** once each gap is fixed or accepted: safety rules as hard invariants, timing rules as service targets, with the director-off fixture re-recorded.

The fixes land as PRs B to F of the sim-audit workstream (plan.md), each reviewed before the next.

## Consequences

- The resident card schema gains an advance care plan and an IDDSI level (validators and the admissions card updated); `data/director.json` gains visiting settings.
- Director-off runs change in most fix PRs (calm days are affected), so the golden fixture is re-recorded on purpose each time.
- More staff come and go (female cover, main-building help by day); the floating and main-building carers' time on site is watched in the reports.
- Some tuning rules (docs/12) may no longer be needed once the underlying behaviour is fixed; the tuning review is re-run.
- With the monitor wired in, `invariant.violated` covers far more than today, so a regression in any of these areas fails the tests.

## Alternatives considered

- **Keep the blanket outbreak ban:** simpler, but contrary to current guidance and Regulation 9A, and it hides the visiting effects the test bed should measure.
- **A visitor limit of 1 (the earlier essential-care-supporter guidance):** stricter than current guidance; 2 keeps a couple visiting together.
- **Keep the monitor as audit tooling only:** fewer fixture changes, but regressions would only show when someone runs the fuzz runner.

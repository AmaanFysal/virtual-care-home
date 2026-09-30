# Progress: Phase 2 (the scenario director)

> Updated at the end of every session (see the `pre-pr` skill).

## Status

Sub-milestone (a) merged (PR #7). Sub-milestone (b) built on branch `director-outbreaks` (2026-09-30), PR open.

## Done

- (a) Director core:
  - **Roadmap:** the director is Phase 2 and LLM minds Phase 3 (CLAUDE.md, docs 00, 01, 06, 08, 09, 11, 12, the phase-1 spec and PROGRESS). ADR-0005 records the swap, the constitution wording and the design decisions.
  - **Engine:**
    - `director` option on `createSim`, off by default, with a `director` RNG stream;
    - daily planning (`director/plan.ts`: day type, sick calls and no-shows, falls, pacing caps);
    - `director.day_planned`, `director.planned` and `director.suppressed` events;
    - a single input dispatch with `input.skipped`;
    - scenario files and `validateScenario`;
    - the cover rule (`cover.ts`: bank, then agency, then short or stay on), with `staff.absent`, `rota.cover_booked` and `rota.no_cover`;
    - handovers when the floor cover is missing;
    - missed rounds logged when nobody meds-trained is on;
    - short-staffed breach causes;
    - `simDate` and a calendar for any year.
  - **Data:** `data/director.json`; `data/scenarios/calm-week.json` and `short-staffed-weekend.json`.
  - **Server:** `DIRECTOR`, `SCENARIO` and `DEATHS` env; the `inject` command; director settings in the run row; `director` in the snapshot.
  - **Web:** Director tab (mode, scenario, triggers), Notable feed, Director and Health categories, source filter.
  - **CLI:**
    - `sim --director … --scenario …`;
    - `--report` with a per-day report, and `--seeds` for several seeds with totals;
    - `--audit` with a per-day section;
    - `director-rates`.
  - **Tests:** `director-off.test.ts` (8 seeds byte-identical to main) and `director.test.ts` (scenario replay and outcomes, the cover rule, pacing caps, realised rates, the calendar, validators); server `inject` tests. 222 tests in all after the review changes.
  - **Results:** realised rates within 2.5% of base (falls 7.67 against 7.49 a year, sick calls 61.8 against 62.2). The caps hold back 0.4 sick calls and under 0.01 serious falls a year. Over 4 weeks × 8 seeds: 0 hard violations and 12 breaches, 11 of them on days with a director event (see `reports/`). The director-off audit is unchanged (142 flags).

- Rebased onto the overlapping-falls fix (PR #6). Then, on review (2026-09-30):
  - no overnight staying on: at night with no cover, a carer comes over from the main building (1 to 2 hours) and the late carer stays on only until she arrives;
  - a round nobody on the wing can give: the on-call RN comes over (about 30 minutes) and gives it;
  - simple hospital return after 3 to 10 days (seeded), back to their own bed with the same care profile;
  - the fall icon is red only while on the floor, a calm "observe" icon during post-fall observations, cleared when they end;
  - the cover rule draws from its own `cover` stream, so the director's plans don't shift with cover outcomes.
  - 4-week report, seeds 1 to 8: 0 hard violations, 27 breaches (24 on days with a director event), 49 sick calls, 2 hospital stays with returns (`reports/a-random-4-weeks-seeds-1-8-v2.txt`).

- (b) Outbreaks and isolation, on branch `director-outbreaks` (2026-09-30):
  - **Engine:** `src/infection.ts` (infection state on each person, pluggable routes (contact and the airborne proxy), isolation, outbreaks declared and over); staff taken ill go home with cover, and miss shifts until clear; the Lounge closes and only essential visits go ahead during an outbreak; PPE minutes for isolated residents; introductions from the director; outbreak and isolation breach causes; an `infection` random stream.
  - **Data:** the `infection` section of `data/director.json`; `data/scenarios/norovirus-outbreak.json` and `flu-outbreak.json`.
  - **Web:** an unwell icon, the infection status in the inspector, infection triggers in the Director tab, Notable lines for cases and outbreaks.
  - **Fixed along the way:** a night bridge booked for a carer who then went home ill left the floor uncovered (found on norovirus seed 6).
  - **Tests:** `outbreaks.test.ts` (routes, both scenarios with outcomes and replays, staff going home ill, introductions); a web icon test.
  - **Outbreak end** switched to UK practice on review (norovirus 48 h after the last case is symptom-free; flu 5 days after the last onset, UKHSA 2024; never while a case is ill).
  - **Results:** 4 weeks random, seeds 1 to 8: 0 hard violations, 18 breaches, 2 outbreaks (6.2 and 5.3 days). Both scenarios on seeds 1 to 8 over 3 weeks: 0 hard violations; outbreaks 3 to 14.6 days (reports in `reports/b-*.txt`).

## In progress

- None.

## Next

- The project owner reviews (a).
- The project owner reviews (b).
- Before (c): cite a hospital admission rate and draft `data/personas/admissions.json` for review.

## Blockers

- None.

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-09-30 | Sub-milestone (b): infections, isolation, outbreaks, two outbreak scenarios | 0 hard in all runs; 2 outbreaks in 4 random weeks |
| 2026-09-30 | Rebased on the falls fix; main-building night cover, on-call RN for missed rounds, hospital return, calmer post-fall icon, separate cover stream | 4-week report re-run: 0 hard, 27 breaches |
| 2026-09-30 | Design agreed (ADR-0005); sub-milestone (a) built | Director core, cover rule, scenarios, admin panel, Notable feed, per-day report; 0 hard violations over 4 weeks × 8 seeds |

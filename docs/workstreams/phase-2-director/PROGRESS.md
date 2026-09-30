# Progress: Phase 2 (the scenario director)

> Updated at the end of every session (see the `pre-pr` skill).

## Status

Sub-milestones (a), (b) and (c) merged (PRs #7, #8 and #9). Sub-milestone (d) built on branch `director-visitors` (2026-09-30), PR open.

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
  - **On review:** outbreaks are declared and ended per disease as UK guidance has it.
    - Norovirus: 2 cases within 48 hours; over 48 h after the last case is symptom-free and 72 h after the last onset.
    - Flu: 2 resident cases within 5 days, staff not counted; over 5 days after the last resident onset (UKHSA 2024).
    - Fixed: an outbreak could end while an agency worker who had caught it was still ill, because they had left the world.
  - **Results:** 4 weeks random, seeds 1 to 8: 0 hard violations, 20 breaches, 1 outbreak (5.3 days). Both scenarios on seeds 1 to 8 over 3 weeks: 0 hard violations; norovirus outbreaks 3 to 14.4 days, flu 5 to 12.6 (reports in `reports/b-*.txt`).

- (c) Illness, hospital, end of life and admissions, on branch `director-health` (2026-09-30):
  - **Sources:** hospital admissions 0.70 per resident a year (Health Foundation 2019); stays by cause (serious fall 11 to 25 days, chest infection 5 to 12, UTI 3 to 10, dehydration 3 to 7), each with its source in `data/director.json` and docs/10.
  - **Engine** (`src/health.ts`, planner steps 5 and 6):
    - illness at home (rest, hourly checks, drinks, falls ×1.5) or severe (GP, ambulance, a stay by cause);
    - care changes after a stay as overrides on the run's copy of the card, logged and ended in any order;
    - end-of-life decline (hourly checks, family daily, later and longer), then the last days (in bed, pads in bed, checks every 30 minutes);
    - death with dignity (family told, Regulation 16 flagged, room left empty, visitors stop);
    - admissions from reviewed cards 2 to 6 weeks after a death, with the room set up for them;
    - a `health` random stream; the deaths switch in force.
  - **Data:** `data/director.json` `health`; `data/personas/admissions.json` with Kamala Shah, reviewed by the project owner.
  - **Everywhere a resident joins or leaves:** inspector ("Died"), a stand-in sprite by gender, handovers, visitor links, Notable, Director tab triggers (illness, end of life, admission), the audit and the reports. `spriteClashes` (shared-types) checks that nobody on screen shares a sheet: an audit flag and a line in the multi-seed report.
  - **On review:** card approved as drafted; end-of-life checks hourly during the decline and every 30 minutes in the last 3 days.
  - **Fixed along the way:**
    - a handover's floor cover could go on a break;
    - a walking resident couldn't move into Raj's room;
    - a resident leaving for hospital or dying left anyone working with them stuck on a task that no longer existed;
    - overlapping care changes ended in the wrong order;
    - the last days' turns were measured from a turn never needed;
    - a bed-bound dying resident could still be walked to the toilet.
  - **On review, before merging:** Kamala, Hema, Kiran and Nikos imported from the characters folder; Nikos Georgiou (`rota.json` `main_building_carer`) is the main building's one cover carer, for nights and for falls, never both at once; a walking-stick overlay for everyone whose card says they use one (Win, Kamala). The director-off fixture was re-recorded on main with `sim.started`'s `dataVersion` blanked (adding Nikos to the data changes that string only; every other byte matched main).
  - **Tests:** `health.test.ts` (16), web sprite tests (clashes, walking aids), Nikos not sent twice. 258 tests in all.
  - **Results:**
    - realised rates: admissions 3.99 against 4.20 a year (−5.1%, caps), deaths 1.57 against 1.57;
    - 12 weeks × 8 seeds: 0 hard violations, 121 breaches (23 on days without a director event), 3 deaths and 3 admissions, 7 hospital stays within their ranges, nobody on screen sharing a sheet;
    - director-off golden test and audit (142 flags) unchanged (`reports/c-*.txt`).

- (d) Visitors and celebrations, on branch `director-visitors` (2026-09-30):
  - **Missed weeks** for the 14 regular visitors (reliability 0.5 or more): about 5 a year with a cause (holiday, illness, family) and seasons, planned on Mondays from their own `visitor_weeks` stream; the rest of the week's visits cancelled; other weeks scaled up so visits stay the same on average. Occasional visitors keep their pattern.
  - **Celebrations** from the calendar: birthdays from each card's dob, festivals from faith (Christmas for everyone, Easter, Vaisakhi, Diwali); the family come 14:00 to 15:00 and stay longer; tea and cake 15:00 to 16:00 in the Lounge (or the resident's room), led by Bev on her days; no gathering during an outbreak. The `birthday-party` scenario.
  - **Also:** admin-panel inputs are checked against the run's own data, so a resident who moved in can be picked.
  - **Web:** Week off, Birthday and Festival triggers; Notable lines; celebrations under Visitors in the log.
  - **Reporting:** visitors and Lounge person-hours per day and at tea; missed weeks by cause and month; celebration days against ordinary days.
  - **Tests:** `celebrations.test.ts` (12). 270 tests in all; director-off golden and audit (142 flags) unchanged.
  - **Results:** missed weeks −0.9% against base, every other rate unchanged. Over a year × 8 seeds: 8.6 visitors on celebration days against 4.9, and at tea 3.9 visitors in the Lounge against 1.0; 0 hard violations; Dennis's turn drift with Kamala (docs/12) is most of the calm-day breaches (`reports/d-*.txt`).
- Roadmap: `docs/roadmap.md`, with the v1.0-testbed milestone next after (e).

## In progress

- None.

## Next

- The project owner reviews (d).
- (e) Tuning-debt review, on branch `director-tuning-review`.
- Then the **v1.0-testbed** milestone (project owner, 2026-09-30; `docs/roadmap.md`): a world description published every step (activity type and intensity per person, touches on objects, doors and windows with states and rules, equipment in use, outdoor weather) and a plug-in API for external models (air, heat, surfaces, energy), with lockstep and recording. It starts with an ADR amending constitution rule 4. Environmental models come after it.

## Blockers

- None.

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-09-30 | Sub-milestone (d): visitors' missed weeks, birthdays and festivals, birthday-party scenario; roadmap with v1.0-testbed | 0 hard over a year × 8 seeds; celebration days 8.6 visitors against 4.9 |
| 2026-09-30 | Sub-milestone (c): illness, hospital, end of life, admissions; card reviewed; end-of-life checks 60 then 30 min; Kamala's family and Nikos imported, walking sticks | 0 hard over 12 weeks × 8 seeds; 3 deaths, 3 admissions; no sprite clashes |
| 2026-09-30 | Sub-milestone (b): infections, isolation, outbreaks, two outbreak scenarios | 0 hard in all runs; 2 outbreaks in 4 random weeks |
| 2026-09-30 | Rebased on the falls fix; main-building night cover, on-call RN for missed rounds, hospital return, calmer post-fall icon, separate cover stream | 4-week report re-run: 0 hard, 27 breaches |
| 2026-09-30 | Design agreed (ADR-0005); sub-milestone (a) built | Director core, cover rule, scenarios, admin panel, Notable feed, per-day report; 0 hard violations over 4 weeks × 8 seeds |

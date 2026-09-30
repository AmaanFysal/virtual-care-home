# Plan: Phase 2 (the scenario director)

> Written in plan mode after the design in docs/10 was agreed (2026-09-30). One sub-milestone per branch and PR, starting with `scenario-director`.

## Approach

Everything goes through the existing input path, so manual triggers, scripted scenarios and random events share one dispatch and one log. The director plans once a day, as a pure function, so it can be tested and its rates measured on their own. The rules react; the director never moves people or assigns tasks. A golden test keeps the director-off engine byte-identical to main.

## Tasks

| # | Task | Docs affected | Done when |
|---|------|---------------|-----------|
| a (built) | **Director core:** switch, `director` stream, daily planning and pacing, `director.planned`; falls and sick calls or no-shows with the cover rule; scenario files and validator (`calm-week`, `short-staffed-weekend`); `inject` command, Director tab, Notable feed, Director and Health categories, source filter; director-aware breach causes; per-day report and `director-rates`; calendar over any year; golden director-off test; ADR-0005; roadmap renumbering | CLAUDE.md, 00, 01, 03, 05, 06, 07, 08, 09, 10, 11, 12, ADR-0005 | Tests pass; director off is byte-identical; 4 weeks × 8 seeds with 0 hard violations and a per-day report |
| b (built) | **Outbreaks and isolation:** infection state, contact route and airborne proxy, isolation, Lounge closure, restricted visiting, staff off sick, declared and over; `norovirus-outbreak` scenario | 04, 05, 07, 08, 10, 11 | The scenario's expected outcomes pass; spread rates reported |
| c (built) | **Illness, hospital, end of life and admissions:** cite the admission rate first; in-room illness; admission and return with care-profile overrides; end-of-life decline; death and the empty room; `deaths: false`; admissions from `admissions.json` (reviewed card) | 05, 06, 07, 08, 10, 11, 12 | A resident can leave and come back changed; a death is handled with dignity; an admission is validated |
| d | **Visitors and celebrations:** explained missed weeks, birthdays and festivals | 05, 06, 10 | Missed weeks carry causes; celebrations bring the family |
| e | **Tuning-debt review:** each rule in docs/12 removed in turn against the calm-week baseline; keep only those that stop breaches going over 2 a week | 12 | Each rule kept or removed with its measurement |

## Risks

- Behaviour changing with the director off: the golden test must stay green. If a rule change has to alter it, re-record the fixture on purpose and say why.
- Mid-run deaths and admissions (c) touch the inspector, sprites, handover notes and visitor links, which assume six fixed residents.
- Sensitive content (c): deaths and end of life handled with dignity, with no drama framing.
- Base rates are approximate and live in data; the admission rate needs a source before (c).

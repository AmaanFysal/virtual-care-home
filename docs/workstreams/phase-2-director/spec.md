# Workstream spec: Phase 2 (the scenario director)

**Goal:** a director that makes unplanned events happen at realistic, context-adjusted rates without an LLM, and runs scripted scenarios exactly, so hard days can be watched, replayed and compared.

Source: [docs/10](../../10-director-and-scenarios.md) (the design), [ADR-0005](../../adr/0005-scenario-director-before-llm-minds.md) (why it comes before LLM minds, and the design decisions). Constraints: [00-constitution](../../00-constitution.md).
Status: **agreed 2026-09-30.** Sub-milestone (a) built; (b) to (e) to come. Tasks are in [plan.md](plan.md).

## In scope

- **Director core:**
  - a master switch, off by default, with the event log byte-identical to main when off;
  - a `director` RNG stream;
  - daily planning with day types and pacing caps;
  - every event an input with `source: "director"`, logged when planned.
- **Events:**
  - falls from base rates (a);
  - sick calls and agency no-shows with the cover rule (a);
  - outbreaks and isolation (b);
  - illness, hospital admission and return, end of life, death, new admissions (c);
  - visitors' missed weeks with causes, and celebrations (d).
- **Scripted scenarios:** `data/scenarios/*.json` with a validator: `calm-week` and `short-staffed-weekend` (a), `norovirus-outbreak` (b).
- **UI:**
  - an admin "Director" tab that triggers any event;
  - a Notable feed;
  - event log categories Director and Health, and a source filter.
- **Reporting:**
  - director-aware breach causes;
  - a per-day report (`sim --report`, `sim --audit`);
  - realised rates against base rates (`director-rates`).
- **Tuning-debt review** (e): test each tuning rule in docs/12 for removal against the calm-week baseline.

## Decisions (2026-09-30)

1. **Hospital admission rate:** the placeholder (about 3 to 6 a year) for (a) and (b). Cite a source and update `data/director.json` before building (c).
2. **New admissions:** the first card in `data/personas/admissions.json` is drafted during development; the project owner reviews it before it's used.
3. **Pacing:** day types ordinary about 70%, busy about 22%, hard about 8%; at most one major event a day and 48 h between majors; at most 2 hard days a week and 2 sick calls a day; no new outbreak within 14 days. All of these are in `data/director.json`. Verification confirms the realised rates after the caps still match the base rates, and reports anything the caps suppress.
4. **Infection routes:** separate, pluggable routes per disease, with per-disease weights in data. Contact is built in (b). An airborne proxy (time in the same room as an infectious person, scaled by the airborne weight, logged as "airborne (proxy)") fills the airborne slot until the air model replaces it. The routes combine as `p = 1 − Π(1 − p_route)`, so nothing is double-counted. Steriliser experiments need the real air model, not the proxy.
5. **Deaths switch:** `deaths: false` turns off deaths and end-of-life decline for the public demo; on by default.
6. **Doc 10's events table**, row 5: contact plus the airborne proxy, replaced later by the air model.

Decisions made while building (a):

7. **Cover order:**
   - bank (care-assistant and night slots only; 11 hours' rest; 50% say yes);
   - then agency (arriving 60 to 120 min after the call; a lead's slot always gets a meds-trained agency senior; other slots 85%);
   - then nobody: a day shift runs short; at night a carer comes over from the main building (1 to 2 hours) and the late carer stays on only until she arrives (user decision, 2026-09-30).
8. **Handovers when the floor cover is missing:** an incoming member who is on the wing covers the floor; with nobody to cover or receive it, the handover is skipped and the written notes stand in.
9. **A med round nobody can give** (only if a scenario forces a lead's slot to go uncovered): the on-call RN comes over (about 30 minutes) and gives it (user decision, 2026-09-30).
10. **Skipped inputs:** an input that can't apply (a fall for a resident in hospital, a sick call for someone already at work) is logged as `input.skipped`, for any source.
11. **Breach cause for short staffing:** runs from the shift start until an hour after cover arrives.
12. **Hospital return** (user decision, 2026-09-30, ahead of c): 3 to 10 days after conveyance (seeded), back to their own bed with their care profile as before.
13. **Fall icon:** red only while on the floor; a calm "observe" icon during post-fall observations, cleared when they end.

Decisions made while building (b):

14. **Infection course and spread** (docs/10 "Infections and outbreaks"):
    - norovirus incubation 12 to 48 h, symptoms 1 to 3 days, infectious from 6 h before symptoms to 48 h after;
    - flu incubation 1 to 4 days, symptoms 3 to 7 days, infectious from 24 h before to 24 h after;
    - contact 0.006 a minute within 1.5 m; airborne proxy 0.1 an hour in the same room; PPE with isolated residents (contact ×0.3, airborne ×0.5).

    All of it is in `data/director.json`, calibrated to plausible care-home attack rates.
15. **Who can catch it:** residents, staff and agency workers; not visitors or people from the main building.
16. **Introductions** are major events, and none comes while an outbreak is on or within 14 days of one ending.
17. **The rules need the tuning file** even with the director off (a manual infection case): `createSim({ config })`, always passed by the server.
18. **A night bridge** is whoever is on the late shift when the night starts (the one booked may have gone home ill); without one, the late staff stay until relieved. **A night carer taken ill in the night** stays until the main-building carer arrives.
19. **Outbreak end** (project owner, 2026-09-30): UK practice. Norovirus 48 hours after the last case is symptom-free; flu 5 days after the last onset (UKHSA, updated 24 July 2024); never while a case is still ill.
20. **Breach causes** include "during norovirus outbreak (…isolated)" and "isolation care (…)".

## Acceptance for each sub-milestone

- `pnpm typecheck` and `pnpm test` pass, including the director-off golden test (seeds 1 to 8, a week each, byte-identical to main).
- The audit on seeds 1 to 8 with the director off is unchanged.
- With the random director, seeds 1 to 8 over 4 weeks:
  - 0 hard violations;
  - breaches reported per day with causes;
  - realised rates within 10% of the base rates, with suppression reported.
- Each scenario replays to a byte-identical log and has its expected outcomes checked by a test.

## Out of scope

- LLM minds (Phase 3, docs/09).
- The air model and sensors (after v1; constitution rule 4). The airborne proxy is only a co-location rule.
- Branching and timeline scrubbing (Phase 4).

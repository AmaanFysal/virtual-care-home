# Workstream spec: Phase 2 (the scenario director)

**Goal:** a director that makes unplanned events happen at realistic, context-adjusted rates without an LLM, and runs scripted scenarios exactly, so hard days can be watched, replayed and compared.

Source: [docs/10](../../10-director-and-scenarios.md) (the design), [ADR-0005](../../adr/0005-scenario-director-before-llm-minds.md) (why it comes before LLM minds, and the design decisions). Constraints: [00-constitution](../../00-constitution.md).
Status: **agreed 2026-09-30.** Sub-milestones (a) to (e) done. Tasks are in [plan.md](plan.md).

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
19. **Outbreak declaration and end** (project owner, 2026-09-30): UK guidance per disease, with citations in data/director.json and docs/10.
    - **Norovirus:** 2 cases within 48 hours (residents and staff); over 48 hours after the last case is symptom-free and at least 72 hours after the last onset (Norovirus Working Party 2012).
    - **Flu:** 2 linked resident cases within 5 days, with staff cases managed and logged but not counted; over 5 days after the last resident onset (UKHSA, updated 24 July 2024).
    - **Both:** never over while a counted case is still ill.
20. **Breach causes** include "during norovirus outbreak (…isolated)" and "isolation care (…)".

Decisions made while building (c):

21. **Hospital admission rate:** 0.70 per resident a year (Health Foundation, 2019), shared between serious falls and severe illness; stays by cause from sourced ranges (docs/10). Illness kinds, the severe share (40%) and mild durations are assumptions.
22. **Care changes after a stay** are fixed per cause and stored as overrides on the run's copy of the card; values are always the base with the changes still on applied, so overlapping changes end in any order.
23. **End-of-life checks** (project owner, 2026-09-30): every 60 minutes during the decline and every 30 minutes in the last 3 days. In the last days the resident is bed-bound, with pads changed in bed and no call bell (as on Dennis's card).
24. **Death:** the family told, CQC Regulation 16 flagged, the room left empty, visitors stop; anyone working with the resident is freed for other work (also when someone leaves for hospital).
25. **Admissions:** the first card (Kamala Shah) reviewed and approved as drafted (project owner, 2026-09-30). The room is set up for the new resident's seating (a chair, a wheelchair spot or neither). Kamala, Hema and Kiran have their own characters; a later card without one gets a stand-in by gender, and a check finds anyone on screen sharing a sheet (`spriteClashes`: audit flag and report totals).
26. **Nikos Georgiou** (project owner, 2026-09-30) is the main building's one cover carer (`rota.json`), for a night nobody else can cover and for help during falls, never both at once. Walking sticks are drawn as an overlay for everyone whose card says they use one.

Decisions made while building (d):

27. **Missed weeks** for regular visitors only (reliability 0.5 or more): about 5 a year with a seasonal cause, at most 1 − reliability of their weeks, with the other weeks' quota scaled up so visits stay the same on average. The first design (absences at 1 − reliability per visitor-week) would have had Maureen miss 30% of weeks and Gary 96%, each with a cause. Drawn from a `visitor_weeks` stream of their own.
28. **Celebrations from the calendar** (birthdays from the dob, festivals from the faith: Christmas for everyone, Easter, Vaisakhi, Diwali) are planned by the random director with origin "calendar". Tea and cake is in the Lounge, or in the room of a resident who doesn't use it; Bev leads it on her days, otherwise it comes with the carers' afternoon tea. No gathering during an outbreak.

Decisions made in (e):

29. **The tuning review's method:** each rule switched off on its own against the calm-week baseline (seeds 1 to 8, a week, director off), kept if removing it pushes a week over 2 breaches; then the removals combined and checked on held-out seeds 9 to 16, putting rules back one at a time where needed. Also reported: the same weeks with Kamala in Raj's room, and three-falls sets including the break windows. The director-off golden fixture is re-recorded, as the review changes director-off runs on purpose.
30. **A general rule for Dennis's turns before the handover:** nobody starts long care that a two-person turn they're needed for would fall due during, and the only people free for a pressing turn nobody has reserved yet keep to short work or pressing turns (the sole-partner principle, before a reservation and looking ahead).
31. **Floor cover for a day break or going home counts only staff on a shift**, not visiting helpers.
32. **The final decision rule** goes beyond the calm-week breach criterion (for the project owner to confirm): a rule also stays if removing it fails the held-out seeds (the sole-partner rule), the Kamala weeks (the new turn rule), clearly harms short-staffed days (the floating carer's planning, the evening-crunch move, the briefing hold), or leaves residents' food and drink needs unmet in the audit (the breakfast boost, the tea deadline and the drink with the tablets).

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

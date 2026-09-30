# 10 · Director and scenarios — Phase 2

**Purpose:** the scenario director. It makes unplanned events happen at realistic, context-adjusted rates, without an LLM. It also runs scripted scenarios exactly, so experiments can compare the same days. Manual triggers come from the admin panel.

> Status: **Phase 2** (moved before LLM minds on 2026-09-30, [ADR-0005](adr/0005-scenario-director-before-llm-minds.md)).
> - Sub-milestone (a) is built: the director core, falls, sick calls and no-shows, scenario files, the admin panel, the Notable feed and the per-day report.
> - Sub-milestone (b) is built: infection state, spread through pluggable routes, isolation, outbreaks and the two outbreak scenarios.
> - Sub-milestone (c) is built: illness, hospital stays by cause with care changes after, end of life, death and new admissions.
> - Sub-milestone (d) is built: visitors' missed weeks with causes and seasons, birthdays and festivals.
> - Sub-milestone (e) is done: the tuning review (docs/12), keeping 11 rules (one new) and removing 13.
>
> Source: [plan-v2](research/plan-v2.md) (Base rates for the scenario director, Scenario catalogue). Workstream: [phase-2-director](workstreams/phase-2-director/spec.md). Code: `packages/sim-engine/src/director/`, `src/cover.ts`, `src/infection.ts`, `src/health.ts`, `src/celebrations.ts`, `src/director/calendar.ts`. Tuning: `data/director.json`. Scenarios: `data/scenarios/`.

## How it works

- **Inputs, never side effects.** Everything the director does is an input with `source: "director"`. It's applied at its time through the same dispatch as manual inputs (`applyInput` in `director/director.ts`). The admin panel's triggers use the same input types with `source: "user"`.
  - An input that can't apply when its time comes is logged as `input.skipped` with the reason, for example a fall for a resident in hospital, or a sick call for someone already at work.
- **The director only starts things.** The rules react:
  - the rota's cover rule (`cover.ts`);
  - the fall procedure (`falls.ts`);
  - later, isolation, outbreaks and end-of-life care.
- **Daily planning.** At 00:00, and at the start for the rest of the start day, the director plans the day:
  - the random part (`director/plan.ts`, a pure function of the tuning, the `director` RNG stream, the day's roster and the residents);
  - the scenario's scripted events for that day.

  It logs `director.day_planned {day, dayType, planned, suppressed, downgradedFrom?}`, then `director.planned {inputType, applyT, origin, reason, params}` for each event, and `director.suppressed` for each event a pacing cap held back. The Notable feed leaves plans out, so it never gives away what's coming.
- **Master switch.** `createSim({ …, director: { config, random, scenario?, deaths? } })`. With no `director` option it's off:
  - no director code runs;
  - the `director` and `cover` streams are never drawn;
  - the event log is byte-identical to the engine before the director existed (`test/director-off.test.ts`, seeds 1 to 8, a week each, against fingerprints recorded on main).
- **Replay.** A run replays from the seed, the data, the director settings, the scenario file and the user inputs.
  - The server stores the settings in the `run` row: mode, scenario id and a hash of the scenario, a hash of `data/director.json`, and the deaths switch.
  - Scripted scenarios replay to a byte-identical log (tested).
- **Running it.**
  - Server: `DIRECTOR=off|random|scenario|both` and `SCENARIO=<id or path>` (`DEATHS=off` for the public demo).
  - CLI: `sim --director random|scenario|both --scenario <id>`.

## Events, base rates and the rules they trigger

Rates are for six residents. Every number is in `data/director.json`.

| # | Event (input) | Base rate | Context modifiers | Rule | Status |
|---|---|---|---|---|---|
| 1 | Fall (`inject_fall`) | 1.249 per resident a year (1,249 per 1,000 residents; plan-v2), about 7.5 a year on the wing. 12% serious (a major event) | Hour weights with a morning peak (06:00 to 10:00). ×1.5 for 4 h from a sundowning resident's onset: this moves their falls to dusk rather than adding more. Falls risk high ×2, medium ×1, low ×0.3, bed-bound ×0.1: these share out the wing's rate rather than adding to it. ×1.3 during a shift with a planned absence. ×1.5 while ill, and ×1.5 for 2 weeks after a hospital return (these add falls) | The fall procedure, unchanged | (a) built; illness and return factors (c) |
| 2 | Sick call (`staff_sick {staffId, cover?}`) and agency no-show (`shift_no_show {slot, cover?}`) | Each rostered shift in a care or RN slot: the staff card's `sickness_propensity` (about 1.2 calls a week); each agency shift 2%. Winter (Nov to Mar) ×1.3 | The call comes 30 to 60 min before the shift; a no-show is found at the shift start | The cover rule (below) | (a) built |
| 3 | Visitor misses a week (`visitor_week_off {visitorId, cause}`) | About 5 weeks a year for each regular visitor (reliability 0.5 or more), at most 1 − reliability of their weeks; their other weeks are scaled up so visits stay the same on average. Occasional visitors keep their pattern | Holidays in July, August and at Christmas; illness in winter | The rest of that week's visits cancelled, with the cause logged | (d) built |
| 4 | Illness (`resident_illness {residentId, kind, severity}`), hospital admission and return | 0.70 unplanned admissions per resident a year (Health Foundation 2019), 4.2 a year on the wing: serious falls plus severe illness. About 5 more illnesses a year looked after at home | Chest infections ×1.5 in winter | Mild: rest in their room, hourly checks, drinks at every contact, falls ×1.5. Severe: GP, then ambulance. A stay by cause, then care changes stored as overrides (see "Illness, hospital, end of life and admissions") | (c) built |
| 5 | Infection (`infection_case {personId, disease}`) | Norovirus about 1 a winter, flu about 1 a winter | Season; visitors and new admissions can bring it in | Symptomatic residents isolated (care and meals in their room, no Lounge, +3 min per care visit for PPE); sick staff go off through the cover rule for 48 h after symptoms stop. Outbreak declared at 2 cases within 48 h (Lounge closed, essential visits only) and over after 48 h with no new case. **Spread through per-disease routes: contact, plus an airborne proxy (time in the same room as an infectious person, scaled by the disease's airborne weight, logged as "airborne (proxy)"), replaced later by the air model in the same slot** (see "Infection routes") | (b) built |
| 6 | End of life (`end_of_life_start {residentId, expectedDays}`), death, admission (`admission {cardId}`) | 0.262 deaths per resident a year (26.2% within a year; plan-v2), 1.6 a year on the wing, through a planned decline of 7 to 28 days | A resident already on an end-of-life plan (Dennis) ×10 | Checks hourly (every 30 min in the last 3 days), family visiting every day, later and for longer; death at the planned time, handled with dignity (family informed, the room left empty, a quiet log). A new admission 2 to 6 weeks later from `data/personas/admissions.json`, reviewed by the project owner first. Off with `deaths: false` | (c) built |
| 7 | Celebrations (`celebration {kind, name, residentIds}`) | Birthdays from each dob; festivals from faith: Christmas (everyone), Easter (Christian), Vaisakhi (Raj), Diwali (Kamala) | Not during an outbreak | More family, longer visits, tea and cake in the Lounge (or their room) with Bev if she's on | (d) built |

## The cover rule (sub-milestone a)

A sick call hits the staff member's next shift that hasn't started. A no-show hits the slot's next shift. The shift is taken off the rota (`staff.absent {staffId, name, slot, shift, reason, shiftStartT}`) and cover is sought, in this order:

1. **Bank:** Lucy or Shanice, for care-assistant and night slots only (they aren't meds-trained).
   - They must be free, with 11 hours' rest either side against the planned shifts and the rota for the days around it.
   - Each says yes with a 50% chance.
   - They arrive 30 to 60 min after the call, or 10 min before the shift if that's later.
2. **Agency:** booked at the call, arriving 60 to 120 min after it (so usually late for an early shift).
   - **RN slot:** an agency nurse.
   - **Lead's slot:** a meds-trained agency senior, always found. Someone meds-trained must be on the wing.
   - **Other slots:** found with an 85% chance.
3. **Nobody.** A day shift runs short (`rota.no_cover`).
   - **Nights:** the wing is never left to the floating carer alone. Nikos Georgiou, the main building's cover carer (`rota.json` `main_building_carer`), comes over, arriving 1 to 2 hours after the gap is known (`cover: "main_building"`). He's the same person who's sent for when everyone is with a fallen resident, so while he covers a night he can't be sent for again, and if he's here for falls he stays on for the night. The late carer (or the late lead) stays on only until he arrives (`cover: "stay_on"` with `untilT`), then goes home; nobody stays on overnight, and everyone else keeps 11 hours' rest. There's no evening handover; the main-building carer hands over at 07:00. The shift isn't counted as short.

The run logs `rota.cover_booked {slot, shift, forStaffId, cover, staffId, arriveT, untilT?}`. The cover rule draws from its own `cover` stream, so the director's daily plans don't shift when how cover plays out changes.

**Handovers when someone is missing.** If the floor cover's slot is short when a handover starts, an incoming member who is on the wing covers the floor instead and reads the notes. If nobody is there to cover or to receive the handover, the written notes stand in for it.

**Medication.** If a scenario forces a lead's slot to go uncovered and nobody meds-trained is on at a round's time, the on-call RN comes over from the main building (25 to 35 minutes) and gives the round (`med_round.no_giver`, `on_call_rn.called`); she goes back once it's done.

A scenario can force the outcome with `cover: "bank" | "agency" | "none"`. A manual sick call with the director off always finds the first free bank carer, otherwise agency, since it can't draw on the director's chances.

**Breach causes.** From the shift start until an hour after cover arrives (or the whole shift with no cover), `sla.breached` causes include "short-staffed: Tom off sick (early), agency from 08:16". Fall causes come first, and several causes are joined with "; ". "No emergency" stays for calm days.

## Pacing

- **Day type.** Each day's type is drawn first and scales every rate that day: ordinary 70% (×0.7), busy 22% (×1.4), hard 8% (×2.6). The weighted mean rate is 1.006, so the base rates hold on average.
- **Caps:**
  - at most one major event a day (a serious fall; later an admission, an outbreak starting or a death);
  - at least 48 h between majors (outbreak cases and a planned death excepted);
  - at most 2 hard days in any 7 (a third is drawn as busy);
  - at most 2 absences a day;
  - no new outbreak within 14 days of the last one ending.
- **Scripted events** aren't capped, but count towards the caps.
- **Rule-driven events** (spread in an outbreak, staff catching it) aren't capped.

**Realised rates** (`pnpm --filter @vch/sim-engine director-rates`: the planner alone, 8 seeds × 200 years, all six residents present):

| | Realised a year | Base | Difference |
|---|---|---|---|
| Falls | 7.67 | 7.49 | +2.4% (short-staffed shifts ×1.3; mean day-type rate 1.006) |
| Serious falls | 0.92 | 0.90 | +2.6% |
| Sick calls | 61.75 | 62.18 | −0.7% |
| Agency no-shows | 5.22 | 5.22 | 0.1% |

Day types came out at 70.1 / 22.5 / 7.5%; 0.5% of days were drawn hard and capped to busy.

The caps held back very little:
- 0.38 sick calls a year (absence cap);
- 0.016 no-shows a year;
- 0.008 serious falls a year (the major-event caps).

No event type is meaningfully suppressed.

## Scripted scenarios

`data/scenarios/*.json`, checked by `validateScenario` (in the data tests, by the server at start-up and by the CLI):

```json
{
  "id": "short-staffed-weekend",
  "name": "A short-staffed weekend",
  "description": "…",
  "random": false,
  "events": [
    { "day": "Fri", "time": "06:15", "type": "staff_sick", "params": { "staffId": "stf_tom", "cover": "agency" } },
    { "day": "Sat", "time": "20:30", "type": "shift_no_show", "params": { "slot": "night.carer", "cover": "none" } },
    { "day": "Mon", "time": "12:30", "type": "staff_sick", "params": { "staffId": "stf_aisha", "cover": "bank" } }
  ]
}
```

- **Timing.** `day` means the first such weekday on or after the run's start; a time already past on the start day means the next week. Add `week: n` for later weeks, or give an absolute `t` instead.
- **Random events too.** `"random": true` (or `DIRECTOR=both`) also runs the random director.
- **Files:**
  - `calm-week`: no events and no random ones. This is the baseline for the tuning-debt review.
  - `short-staffed-weekend`: Tom off sick on Friday's early (agency from about 07:20); Saturday's agency night carer doesn't come and Shanice stays on; Aisha off sick on Monday's late, covered by Lucy. It's checked by `test/director.test.ts` (0 hard violations on every tick, and a byte-identical replay).
  - `norovirus-outbreak`: Stan falls ill on Wednesday at 14:20 and Peggy on Thursday at 09:10, which declares the outbreak.
  - `flu-outbreak`: Win falls ill with flu on Thursday at 10:00 (brought in by a visitor); Tom on Friday at 05:30, at home before his early shift (a staff case: off work and logged, not counted); Arthur on Saturday at 16:00, the second resident case within 5 days, which declares the outbreak.
  - Both are checked by `test/outbreaks.test.ts`: expected outcomes and a byte-identical replay (seed 1, 16 days).

## Admin panel, Notable feed and event log (docs/08)

- **Director tab**, next to the inspector:
  - it shows the run's mode, scenario and deaths setting;
  - it triggers any event (a fall, a sick call or a no-show, with its cover choice) as an `inject {input, params}` command. The server validates it (`validateInput`) and applies it as a `source: "user"` input. The inspector's fall buttons still work.
- **Notable feed**, at the top of the sidebar: falls, 999 and hospital, sick calls and cover, missed rounds, skipped inputs, service breaches and hard violations. Each row has its time and source tag; click to select the person.
- **Event log:**
  - new categories **Director** (everything the director planned or did) and **Health** (hospital, and later illness, infection and end of life);
  - staff absences and cover are under Staff;
  - a source filter (any, engine, director, user).

## Reporting

- **`sim --report`** with the director on adds a per-day report:
  - each day's type (and whether it was capped);
  - what happened (falls, absences and their cover, events held back or skipped);
  - every breach with its cause, and any hard violation.
- **`sim --report --seeds 1-8`** prints it for each seed, with totals:
  - days by type, falls, sick calls, no-shows, cover outcomes;
  - what the caps held back;
  - breaches on days with and without a director event, grouped by target and cause.
- **`sim --audit`** with the director adds the same per-day section.
- **Director-off baseline:** at most 2 reported breaches a week and 0 hard violations (unchanged).
- **Director runs:** 0 hard violations; breaches reported by day and cause, with no cap and no special rules.

**Sub-milestone (a), seeds 1 to 8, 4 weeks each, random director** (reports in `docs/workstreams/phase-2-director/reports/`). With the falls fix, main-building night cover, the on-call RN for missed rounds, hospital return and the separate `cover` stream (2026-09-30):
- 232 days: 70% ordinary, 22% busy, 8% hard, none capped;
- 6 falls (2 serious) and 49 sick calls (1.5 a week), 5 agency no-shows;
- cover: 12 bank, 40 agency, 1 main-building night carer (the late carer bridging until 22:17), 1 with no cover;
- 2 residents taken to hospital and back 9 and 10 days later (Peggy on seed 3, Stan on seed 7);
- 0 hard violations;
- 27 service breaches: 24 on days with a director event (19 short-staffed, 5 with no emergency, e.g. an evening check on a day whose sick call was the early shift) and 3 on days without one.

The first report for (a) (12 breaches, 39 sick calls) came from a different sequence of events: its cover rule drew from the director's stream, so each change to cover reshuffled everything after it. The planner-only rates (`director-rates`) are unchanged.

## Infections and outbreaks (sub-milestone b, built)

Code: `src/infection.ts`. Tuning: `data/director.json` `infection`. It runs only while someone is infected, on its own `infection` random stream, so runs without an infection are unchanged.

- **Introductions** (`infection_case {personId, disease}`): someone falls ill with an infection brought in from outside (a visitor, a new admission, staff), with symptoms now.
  - **From the director:** norovirus about 1 a winter (0.2 over the rest of the year), flu about 1 a winter (0.1). The index case is a resident, or 30% of the time a member of staff on the day's rota.
  - **Pacing:** an introduction is a major event (the major-event caps apply). None comes while an outbreak is on, or within 14 days of one ending (`director.suppressed`, "outbreak quiet period").
  - **By hand or in a scenario:** a scenario or the admin panel can start one. It needs the tuning file, which the server always passes (`createSim({ config })`); without it, the input is skipped.
- **Each person's course**, drawn when they catch it:

  | | Norovirus | Flu |
  |---|---|---|
  | Incubation | 12 to 48 h | 1 to 4 days |
  | Symptoms | 1 to 3 days | 3 to 7 days |
  | Infectious from | 6 h before symptoms | 24 h before symptoms |
  | Infectious until | 48 h after symptoms end | 24 h after symptoms end |
  | Residents isolated / staff off until | 48 h after symptoms end | 24 h after symptoms end |

  Anyone who has had it is immune for the rest of the run.
- **Spread**, once a minute, through separate, pluggable routes, each scaled by the disease's weight (norovirus: contact 0.8, airborne 0.2; flu: contact 0.2, airborne 0.8):
  - **Contact:** 0.006 a minute within 1.5 m of someone infectious (care, sitting together).
  - **Airborne (proxy):** 0.1 an hour in the same room as someone infectious, logged as "airborne (proxy)".
    - It isn't an air model: it reads only who is in which room, so it keeps to constitution rule 4 (no physics in the engine; ADR-0006).
    - The future air model (room air, for example Wells-Riley, which a steriliser can reduce) replaces this term in the same slot (`routeChances` in `infection.ts`), and nothing else changes.
    - **Experiments comparing sterilisers need the real air model, not the proxy:** the proxy has no ventilation or air cleaning, so a steriliser can't change it.
  - **PPE:** with an isolated resident, gloves and aprons scale contact by 0.3, and masks scale the airborne term by 0.5.
  - **No double counting:** the routes combine as independent risks, `p = 1 − Π(1 − p_route)`, over every infectious person and every route. Swapping one route's model changes only its own term.
  - **Who can catch it:** residents, staff and agency workers. Visitors and people from the main building aren't modelled.
- **Isolation.** A resident with symptoms is isolated in their room (`infection.isolated`): care and meals there, no Lounge (someone in it is walked back), and 3 extra minutes for every visit (care, help, drinks and medication) for PPE. It ends with `infection.isolation_ended`.
- **Staff.** A member of staff with symptoms goes home, and misses every shift until they're clear:
  - **Taken ill at work:** they go home (`staff.absent` with reason `went_home_sick`) once the floor is covered, and the rest of the shift is covered by the cover rule. At night, Nikos comes from the main building, and they stay until he's here.
  - **Taken ill off duty:** each shift before they're clear is a sick call, with cover.
- **Outbreaks**, declared and ended per disease as UK guidance has it (`infection.outbreak` in `data/director.json`, with the citations):

  | | Declared | Counted cases | Over, and never while a counted case is still ill |
  |---|---|---|---|
  | Norovirus | 2 or more linked cases within 48 hours | residents and staff | 48 hours after the last case is symptom-free, and at least 72 hours after the last onset |
  | Flu | 2 or more linked resident cases within 5 days | residents only; staff cases are managed (off work, logged) but not counted | 5 days after the onset of symptoms in the most recent resident case |

  - **Sources:**
    - Norovirus Working Party, [*Guidelines for the management of norovirus outbreaks in acute and community health and social care settings*](https://www.gov.uk/government/publications/norovirus-managing-outbreaks-in-acute-and-community-health-and-social-care-settings) (2012, published by PHE on gov.uk). The start: "two or more cases linked in time and place". The end: "48h after the resolution of vomiting and/or diarrhoea in the last known case and at least 72h after the initial onset of the last new case". The 48-hour window for declaring is from local care-home guidance, for example Bolton Council's *Diarrhoea & Vomiting (Enteric) Outbreaks in Care Homes* flow chart: "If there is 2 or more linked cases within 48 hours".
    - UKHSA, [*Management of acute respiratory infection outbreaks in care homes*](https://www.gov.uk/government/publications/acute-respiratory-disease-managing-outbreaks-in-care-homes/management-of-acute-respiratory-infection-outbreaks-in-care-homes-guidance) (updated 24 July 2024). An outbreak is "2 or more ARI or ILI cases in epidemiologically-linked residents", with "a 5-day window for case onset". The end: "Outbreak measures can be lifted 5 days after the onset of symptoms in the most recent symptomatic resident".
    - All six residents of the wing count as linked.
  - **While one is on:** the Lounge closes (everyone stays in their room, and Bev's session doesn't run), and only essential visits go ahead (to a resident at the end of their life: Dennis). Other planned visits are cancelled (`visit.cancelled`); anyone visiting finishes and goes.
  - **Logged as** `outbreak.declared` (with the counted cases) and `outbreak.over` (with its length).
  - **Every counted case's symptom end is recorded on the outbreak** when it's counted. So an outbreak waits for a case who has since left the world, such as an agency worker after their shift.
- **Infection state**, readable by the future air model: `person.infection` holds `{disease, exposedT, route, infectiousFromT, symptomaticFromT, symptomsEndT, infectiousUntilT, isolatedUntilT, …}`. Every change is an event (`infection.exposed` with the route, source and room; `infection.symptomatic`; `infection.recovered`). `PersonView.infection` gives the status and isolation for the badge.
- **Breach causes:** "during norovirus outbreak (Stan, Peggy isolated)", or "isolation care (Stan)" before an outbreak is declared.
- **Calibration** (both scenarios, seeds 1 to 8, 3 weeks each):
  - **Norovirus:** 38% of resident-slots ill (18 of 48, 16 of them the scripted cases) and 28 staff cases, mostly by contact.
  - **Flu:** 15 residents and 23 staff ill, almost all by the airborne proxy. Six seeds stop at the 2 scripted cases; seeds 6 and 8 spread widely through people infectious before their symptoms.
  - These are plausible for a care home but not fitted to data: every number is in `data/director.json`.

**Results with the UK declaration and end rules (2026-09-30):**

| Run | Ill (residents / staff) | Outbreaks, days | Service breaches | Hard violations |
|---|---|---|---|---|
| Random, seeds 1 to 8, 4 weeks | 4 / 7 (4 brought in) | 1: norovirus 5.3 (a flu cluster among staff alone is managed but isn't an outbreak) | 20 | 0 |
| `norovirus-outbreak`, seeds 1 to 8, 3 weeks | 18 / 23 | 9: 3 to 14.4 (median about 7) | 19 | 0 |
| `flu-outbreak` (Win, Tom, Arthur), seeds 1 to 8, 3 weeks | 18 / 25 (16 and 8 of them scripted) | 8: seven of 5 to 5.9, one of 12.6 | 23 | 0 |

## Illness, hospital, end of life and admissions (sub-milestone c, built)

Code: `src/health.ts`, and the planner's steps 5 and 6 (`director/plan.ts`). Tuning: `data/director.json` `health`, with the sources in its notes. It runs on its own `health` random stream, and only for residents it has started something for, so runs without it are unchanged.

- **Hospital admissions: 0.70 per resident a year**, 4.2 a year on the wing. Source: the Health Foundation's [*Emergency admissions to hospital from care homes*](https://reader.health.org.uk/emergency-admissions-to-hospital-from-care-homes/background) (Improvement Analytics Unit, 2019), 0.70 a year for residential homes in England, 2016/17.
  - Serious falls already make 1.249 × 12% = 0.15 of these per resident a year.
  - The rest, 0.55, are severe illness. With 40% of illnesses severe (an assumption), that's 1.37 illnesses per resident a year: 0.55 to hospital and 0.82 looked after at home.
  - Kinds: chest infection 55% (×1.5 in winter), UTI 30%, dehydration 15%.
- **Length of stay by cause** (seeded, uniform over the range; back between 11:00 and 16:00):

  | Cause | Days | Source |
  |---|---|---|
  | Serious fall or fracture | 11 to 25 | [NHFD](https://www.nhfd.co.uk/2024report): mean acute stay 16 days; [REDUCE](https://www.thelancet.com/journals/lanhl/article/PIIS2666-7568(23)00086-7/fulltext): median 20 for care-home residents |
  | Chest infection | 5 to 12 | [BTS pneumonia audit](https://pubmed.ncbi.nlm.nih.gov/21502103/): median 5; Health Foundation: 8.9 on average from residential homes |
  | UTI | 3 to 10 | UKHSA 2023–24 ([Care England briefing](https://www.careengland.org.uk/care-england-briefing-to-members-on-the-ukhsa-report-understanding-the-burden-of-uti-hospitalisations-in-england/)): mean 6.4 |
  | Dehydration | 3 to 7 | [ILC-UK](https://ilcuk.org.uk/wp-content/uploads/2018/10/Hydration-and-older-people-in-the-UK-2.pdf): 4.6; [*Age and Ageing* 2014](https://academic.oup.com/ageing/article/43/suppl_1/i33/88638): median 4 |

  A run without the tuning file (a fall injected by hand with no `config`) keeps the simple 3 to 10 days.
- **Illness at home** (`illness.started`): **mild** means 3 to 7 days resting in their room (no Lounge), checks at least hourly, a drink offered at every contact, and falls ×1.5, then `illness.recovered`. **Severe** means the GP within 1 to 4 hours (`gp.consulted`), then an ambulance in 30 to 90 minutes (a `hospital_transfer` task at the bedside), conveyance with the cause, and the family told.
- **Back from hospital:** `resident.returned_from_hospital {daysAway, cause}`. Care changes by cause are **overrides on the run's copy of the card**, never the data files, each logged as `resident.care_changed {reason, changes, untilT}`, and again when it ends. Walking speed, falls risk and staff for personal care are always the values before the first change with every change still on applied, so changes that overlap (two stays close together) end in any order:
  - serious fall: walks 20% slower, falls risk up a level, two carers for personal care, for good;
  - chest infection: 10% slower and falls risk up, 2 weeks;
  - UTI: falls risk up, 2 weeks; dehydration: falls risk up, 1 week;
  - and falls ×1.5 for 2 weeks after any return.
- **End of life** (`end_of_life.started`): a decline of 7 to 28 days, one at a time and a major event. A resident already on an end-of-life plan (Dennis) is 10 times likelier to be the one.
  - **Decline:** checks every **60 minutes**; the family visits every day (with their usual chance plus 0.5, up to 95%), later (from 2 hours after their usual window opens to 3 hours after it closes, until 20:00) and for 1.5 times as long.
  - **The last 3 days:** in bed, pads changed in bed (turns include a change) and no call bell, as on Dennis's card; comfort care (mouth care and sips) hourly, checks every **30 minutes**, turned 2-hourly from when they're settled (`resident.care_changed`).
  - **Why 60 then 30** (project owner, 2026-09-30): the design first had 30-minute checks for the whole decline. In the 12-week runs that was missed at the same busy time most days (Dennis about 09:15, Arthur about 20:30), about 60 breaches, for weeks on end. Hourly comfort checks during a decline, stepped up as death nears, is closer to usual care-home practice, and the extra checks go where they matter most.
  - **Death** at the planned time (`resident.died`), once any care in progress is finished: the family is told ("died peacefully"), CQC Regulation 16 is flagged, the room is left empty and nobody is woken or moved. The Notable feed has one quiet line ("Dennis died peacefully. Their family have been told."), not an alert. Their visitors stop coming, and their tasks are closed. The handover summary leaves them out.
- **Admissions** (`resident.admitted`): 2 to 6 weeks after a death, at 13:00 to 16:00, the next **reviewed** card in `data/personas/admissions.json` moves into the first empty room (a draft card is skipped with the reason).
  - The room is set up for them: a bedside chair for someone who sits out, a wheelchair spot for a hoist user, neither for someone bed-bound; what the last resident had and they don't need goes (Raj's wheelchair spot).
  - The card is validated like any resident against the wing as it is now, before anything changes.
  - They arrive in their chair (or bed), with checks, meals and medication from their card. Their family join the visitors and start visiting from that week.
  - The first card, Kamala Shah, was reviewed on 2026-09-30.
- **Pacing:** severe illness, an end-of-life start and an admission are major events. The planner uses each resident's current state: someone in hospital or who has died isn't planned for; someone ill or at the end of life gets no new illness; someone ill or back within 2 weeks has falls ×1.5; someone in their last days is bed-bound (falls ×0.1).
- **Breach causes:** "end-of-life care (Dennis): checks every 60 min", "illness (Arthur): checks every 60 min".
- **Everywhere else a resident joining or leaving mid-run shows:** the inspector ("In hospital", "Died"), sprites (a stand-in by gender), handovers, visitor links, the Notable feed, the Director tab (illness, end-of-life and admission triggers), the audit and the reports.

**Results (2026-09-30):** realised rates from the planner alone (`director-rates`, seeds 1 to 8, 200 years each; `reports/c-realised-rates.txt`):

| Event | Realised a year | Base | Difference |
|---|---|---|---|
| Hospital admissions (serious falls plus severe illness) | 3.99 | 4.20 | −5.1% (the major-event caps hold back 0.17 severe illnesses a year) |
| Illness looked after at home | 4.97 | 4.95 | +0.3% |
| End of life (deaths) | 1.57 | 1.57 | +0.1% (the caps hold back 0.09 a year, which come later instead) |

**Random director, seeds 1 to 8, 12 weeks each** (`reports/c-random-12-weeks-seeds-1-8.txt`):
- 19 illnesses: 13 at home (chest infection 7, UTI 6), 6 to hospital (chest infection 4, dehydration 2), plus 1 serious fall. All 7 stays were within their ranges: chest infection 6 to 8 days, dehydration 3 to 7, the serious fall 19.
- 16 care changes logged (after stays, and for the last days); the ones with an end date ended on time.
- 3 end-of-life declines and deaths (Raj on seed 3, Dennis on seed 4, Arthur on seed 7), then 3 admissions: Kamala moved into Room 3, Room 6 and Room 1 2 to 6 weeks later.
- 1 flu outbreak (11.5 days), 187 sick calls.
- **0 hard violations.**
- **121 service breaches:** 98 on days with a director event and 23 on days without (0.24 a week).
  - Short staffing is behind 78, some alongside end-of-life care, an outbreak or illness.
  - 26 fall while someone is at the end of life. 12 of those are the dying resident's own checks, missed by a few minutes; before the change there were about 60 with 30-minute checks for the whole decline.
  - 26 have no emergency behind them. 17 of those are Dennis's turns, mostly in January on seeds 3 and 7: after Kamala moves in, his 2-hourly turns drift to about 06:25 to 06:50, just before the morning handover. They're reported, not patched (docs/12).
- **Sprites:** with the stand-in, people on screen with the same sheet for 275 minutes on seed 7 (Kamala and Pat) and 259 minutes on seeds 2 and 5 (the main-building carer in Lorna's sheet). With Kamala's and Nikos's own sheets (2026-09-30): none.

**Found and fixed while running it:**
- A resident leaving for hospital or dying deleted their tasks without freeing whoever was working on them. On seed 1 an agency nurse stood by Dennis's empty bed every weekend late shift from New Year, behind most of that seed's 48 calm-day breaches.
- Changes that overlapped (two stays close together) ended in the wrong order.
- A walking resident couldn't move into Raj's room (his wheelchair spot was still there).
- In the last days, a bed-bound resident was still walked to the toilet on request.

## Visitors' missed weeks and celebrations (sub-milestone d, built)

Code: `src/visitors.ts`, `src/celebrations.ts`, `src/lounge.ts`, `src/director/calendar.ts`, and step 7 of the planner (`director/plan.ts`). Tuning: `data/director.json` `visitors` and `celebrations`. Missed weeks draw from their own `visitor_weeks` random stream, so every other event the director plans is the same with or without them.

- **Missed weeks** (`visitor_week_off {visitorId, cause}` → `visitor.week_off {cause, untilT}`):
  - **Who:** the 14 lead visitors whose reliability is 0.5 or more (Linda, Chloe, Funmi, Sister Grace, Hannah, Kuldip, Harpreet, Maureen, Tracey, Sarah, Paul, Mia, Pat and Father Michael), plus Kamala's daughter Hema once she moves in. The 7 occasional visitors (Gary 0.04, Bernard 0.05, Sheila 0.1, Tunde 0.12, Colin 0.25, Terry 0.3, Kayode 0.4) keep their weekly quota: their quiet weeks are how they visit, not absences, and logging "holiday" for 96% of Gary's weeks would say nothing. Companions miss the weeks their lead misses.
  - **How often:** about 5 whole weeks a year (an assumption: about 3 on holiday, 1 ill, 1 for family reasons), at most 1 − reliability of their weeks (Kuldip, 0.95: at most 1 week in 20). Planned on Mondays (and on the first day, for the rest of that week).
  - **Seasons:** holidays ×2 in July, ×2.5 in August and ×1.5 in December; illness ×1.8 from November to March; family reasons all year. The factors are normalised over the year.
  - **Visits kept the same on average:** a regular visitor's other weeks use reliability / (1 − share of weeks off) for the weekly quota (docs/05), so over a year they visit as often as with the director off.
  - **Applied:** the rest of that week's visits are off; a visit planned for later that day is cancelled (`visit.cancelled`, "week off (holiday)"); anyone already visiting finishes. Not for the family of a resident at the end of their life.
  - **Why not 1 − reliability per week, as first designed:** Maureen (0.7) would miss 30% of weeks and Gary 96%, each with a cause. The share of weeks off is now a plausible 5 a year, and the rest of reliability stays in the weekly quota.
- **Celebrations** (`celebration {kind, name, residentIds}` → `celebration.started {gathering}`):
  - **From the calendar** in random mode (`origin: "calendar"`, the same in every run): a birthday for each resident on the wing from their card's date of birth; festivals from their card's faith (`celebrations.faiths` maps words like "church", "Catholic" and "Pentecostal" to Christian):

    | Festival | For | Date |
    |---|---|---|
    | Christmas | everyone, faith or none | 25 December |
    | Easter | Christian residents (Peggy, Win, Arthur, Dennis) | Western Easter Sunday (Gregorian computus) |
    | Vaisakhi | Sikh (Raj: "be home for Vaisakhi") | 14 April |
    | Diwali | Hindu (Kamala: "go to the temple for Diwali") | Lakshmi Puja, UK dates 2026 to 2029 from [Royal Museums Greenwich](https://www.rmg.co.uk/stories/time/when-diwali) and [diwali.info](https://diwali.info/diwali-dates) |

    A scenario or the admin panel can start one on any day.
  - **More family:** every lead visitor of the residents celebrating comes with their usual chance plus 0.5 (up to 0.95), arriving 14:00 to 15:00 and staying 1.5 times as long (at least 2 hours); one already coming later that day comes in time for tea instead, and one coming earlier stays until after it. Companions come with at least 0.8. A visitor away that week stays away.
  - **Tea and cake, 15:00 to 16:00:** in the Lounge (everyone who uses it stays for it), or in the resident's room for someone who doesn't (Raj, Dennis). Bev leads it as a session when she's on (Monday to Thursday); otherwise it comes with the carers' afternoon tea. Everyone who came during the hour is logged when it ends (`celebration.tea {roomId, staffId, residentIds, visitorIds}`).
  - **Not during an outbreak:** `celebration.started` with `gathering: false` ("outbreak: no gathering, essential visits only"), no extra visits and no tea.
- **Scenario `birthday-party`:** Peggy's birthday on Wednesday, one of Bev's days. Tested on seeds 1 to 4: her family arrive 14:00 to 15:00 and stay at least 2 hours, at least two of them come to tea in the Lounge with Bev and Peggy, more of her family come than on an ordinary Wednesday and the Lounge is fuller at tea time, 0 hard violations, and a byte-identical replay.
- **Reporting:** the per-day report gives each day's visitors and person-hours in the Lounge (residents and visitors, rebuilt from `person.entered_room`), missed weeks by cause and month, and visitors and the Lounge on celebration days against ordinary days, over the day and at tea (15:00 to 16:00).

**Results (2026-09-30):**
- **Realised rates** (planner only, seeds 1 to 8, 200 years each; `reports/d-realised-rates.txt`):
  - missed weeks 66.96 a year against 67.60 (−0.9%) for the 14 regular visitors: holiday 55%, illness 25%, family 20%;
  - by month, most in August (8.0) and July (7.0), then December (6.7); fewest in September (4.5);
  - every other rate is unchanged from (c), because missed weeks have their own stream.
- **Random director, seeds 1 to 8, a year each** (416 wing-weeks; `reports/d-random-52-weeks-seeds-1-8.txt`):

  | Kind of day | Days | Visitors a day | Lounge person-hours a day (residents / visitors) | In the Lounge at tea, on average (residents / visitors) |
  |---|---|---|---|---|
  | Celebration | 78 | 8.6 | 17.3 / 5.9 | 4.0 / 3.9 |
  | Ordinary | 2,799 | 4.9 | 17.8 / 1.6 | 3.6 / 1.0 |
  | Outbreak | 26 | 1.3 | 1.9 / 0.1 | 0.2 / 0.1 |
  | Celebration during an outbreak (no gathering) | 1 | 1.0 | 0 / 0 | 0 / 0 |

  - The celebrations: every resident's birthday while they were on the wing, Christmas, Easter and Diwali on all 8 seeds (Kamala had moved in by October 2027), Vaisakhi on 6 (Raj had died on 2), and one birthday in a norovirus outbreak with no gathering.
  - Residents' Lounge hours over the whole day aren't higher on celebration days: Christmas (a Friday) and Easter (a Sunday) have no morning session with Bev, and Raj's and Dennis's birthdays are in their rooms. At tea the Lounge is fuller, and visitors in it nearly four times as many.
  - Missed weeks: 504 (holiday 262, illness 141, family 101), cancelling 135 planned visits.
  - 0 hard violations; no sprite clashes.
  - 469 service breaches, 181 on days without a director event. 158 of those are Dennis's turns on the three seeds where Kamala moved in while he was alive (docs/12); without them, calm days have about 0.05 breaches a week.
- **`birthday-party`, seeds 1 to 8, a week each** (`reports/d-birthday-party-1-week-seeds-1-8.txt`): tea with Bev on every seed with 4 residents and 2 to 5 of Peggy's family; 7.5 visitors on the day against 5.2; at tea 3.9 residents and 3.7 visitors against 3.2 and 0.9; 1 service breach in 8 weeks; 0 hard violations.

## Deaths switch

`deaths: false` (server `DEATHS=off`) turns off deaths and end-of-life decline for the public demo: the planner plans none, and a manual or scripted `end_of_life_start` is skipped ("deaths and end-of-life decline are off for this run"). It's on by default for experiments.

## Sub-milestones

- **(a) Director core** (built):
  - the switch, stream, daily planning, pacing and input plumbing;
  - falls, sick calls and no-shows with cover;
  - scenario files and the validator;
  - the `inject` command, Director tab, Notable feed and log filters;
  - director-aware breach causes, the per-day report and the rates script;
  - the calendar over any year (`simDate`);
  - the director-off golden test; ADR-0005.
- **(b) Outbreaks and isolation** (built): infection state, pluggable routes, isolation, outbreaks, staff off sick, the `norovirus-outbreak` and `flu-outbreak` scenarios, the unwell badge and Health filter.
- **(c) Illness, hospital, end of life and admissions** (built): sourced admission rate and stays by cause, illness at home, care changes after a stay, end of life, death, admissions from reviewed cards, the deaths switch.
- **(d) Visitors' missed weeks and celebrations** (built): missed weeks with causes and seasons for regular visitors, birthdays and festivals from the cards with family visits and tea and cake, no gathering in an outbreak, the `birthday-party` scenario.
- **(e) Tuning-debt review** (done): each rule switched off on its own against the calm-week baseline, then combined and checked on held-out seeds, with a new resident's weeks, short-staffed days and the audit; 11 kept (one new), 13 removed; Dennis's turns before the morning handover fixed with a general rule; floor cover for breaks counts only staff on a shift (docs/12, `reports/e-tuning-review.txt`).

## Notes carried from Phase 1

- **Visitors' weeks.** Phase 1 visitors come on a weekly quota of their pattern days (docs/05 "Visiting"), so there are no random bad weeks. With the director on, (d) adds explained absences (illness, holiday, family) for regular visitors, so the log gives a reason for a quiet spell.
- **Already available to scenarios:**
  - the on-call RN coming over for serious night falls;
  - paramedics and conveyance to hospital;
  - the floating night carer's call-outs;
  - CQC Regulation 18 flags;
  - service-target breaches with causes.

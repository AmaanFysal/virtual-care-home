# 10 · Director and scenarios — Phase 2

**Purpose:** the scenario director. It makes unplanned events happen at realistic, context-adjusted rates, without an LLM. It also runs scripted scenarios exactly, so experiments can compare the same days. Manual triggers come from the admin panel.

> Status: **Phase 2** (moved before LLM minds on 2026-09-30, [ADR-0005](adr/0005-scenario-director-before-llm-minds.md)).
> - Sub-milestone (a) is built: the director core, falls, sick calls and no-shows, scenario files, the admin panel, the Notable feed and the per-day report.
> - Sub-milestones (b) to (e) are designed below.
>
> Source: [plan-v2](research/plan-v2.md) (Base rates for the scenario director, Scenario catalogue). Workstream: [phase-2-director](workstreams/phase-2-director/spec.md). Code: `packages/sim-engine/src/director/`, `src/cover.ts`. Tuning: `data/director.json`. Scenarios: `data/scenarios/`.

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
| 1 | Fall (`inject_fall`) | 1.249 per resident a year (1,249 per 1,000 residents; plan-v2), about 7.5 a year on the wing. 12% serious (a major event) | Hour weights with a morning peak (06:00 to 10:00). ×1.5 for 4 h from a sundowning resident's onset: this moves their falls to dusk rather than adding more. Falls risk high ×2, medium ×1, low ×0.3, bed-bound ×0.1: these share out the wing's rate rather than adding to it. ×1.3 during a shift with a planned absence. Later: ×1.5 for 2 weeks after a hospital return, and while ill | The fall procedure, unchanged | (a) built |
| 2 | Sick call (`staff_sick {staffId, cover?}`) and agency no-show (`shift_no_show {slot, cover?}`) | Each rostered shift in a care or RN slot: the staff card's `sickness_propensity` (about 1.2 calls a week); each agency shift 2%. Winter (Nov to Mar) ×1.3 | The call comes 30 to 60 min before the shift; a no-show is found at the shift start | The cover rule (below) | (a) built |
| 3 | Visitor misses a week (`visitor_week_off {visitorId, cause}`) | With the director on, the weekly quota uses every pattern day; absences come from here at 1 − reliability per visitor-week | Holidays in summer and at Christmas; illness in winter | That week's visits cancelled, with the cause logged | (d) |
| 4 | Illness (`resident_illness`), hospital admission, return (`hospital_return`) | About 3 to 6 unplanned admissions a year: a **placeholder**, to be sourced before (c) | Winter ×1.5; frailty; after a fall | Mild: rest in bed or room, extra checks, fluids pushed, falls ×1.5. Severe: GP, ambulance and conveyance. Return after 3 to 10 days with care-profile changes, stored as overrides in resident state (not by editing the cards) | (c) |
| 5 | Infection (`infection_case {personId, disease}`) | Norovirus about 1 a winter, flu about 1 a winter | Season; visitors and new admissions can bring it in | Symptomatic residents isolated (care and meals in their room, no Lounge, +3 min per care visit for PPE); sick staff go off through the cover rule for 48 h after symptoms stop. Outbreak declared at 2 cases within 48 h (Lounge closed, essential visits only) and over after 48 h with no new case. **Spread through per-disease routes: contact, plus an airborne proxy (time in the same room as an infectious person, scaled by the disease's airborne weight, logged as "airborne (proxy)"), replaced later by the air model in the same slot** (see "Infection routes") | (b) |
| 6 | End of life (`end_of_life_start`), death, admission (`admission {cardId}`) | Deaths about 1 to 2 a year (26.2% within a year; plan-v2), mostly through a planned decline | — | Comfort care every 30 min, family visiting more, longer and into the evening; death at the planned time, handled with dignity (family informed, the room left empty, a quiet log). A new admission some weeks later from `data/personas/admissions.json`, reviewed by the project owner first. Off with `deaths: false` | (c) |
| 7 | Celebrations (`celebration {kind, residentId?}`) | Birthdays from each dob; festivals from faith (Christmas, Easter, Vaisakhi for Raj, …) | — | All the family visits, longer visits, tea and cake in the Lounge | (d) |

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
   - **Nights:** the wing is never left to the floating carer alone. A carer comes over from the main building, arriving 1 to 2 hours after the gap is known (`cover: "main_building"`, a Main-building Night Carer, drawn in the main-building uniform). The late carer (or the late lead) stays on only until she arrives (`cover: "stay_on"` with `untilT`), then goes home; nobody stays on overnight, and everyone else keeps 11 hours' rest. There's no evening handover; the main-building carer hands over at 07:00. The shift isn't counted as short.

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
  - `norovirus-outbreak`: comes with (b).

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

## Infection routes (sub-milestone b)

- **Separate routes per disease.** Spread is modelled through separate, pluggable routes. Each gives its own chance per exposure, scaled by the disease's weight in `data/director.json`: norovirus contact 0.8 and airborne 0.2; flu contact 0.2 and airborne 0.8.
- **No double counting.** The routes combine as independent risks, `p = 1 − Π(1 − p_route)`. Swapping one route's model changes only its own term.
- **Contact:** a chance per care contact or close co-location.
- **Airborne (proxy):** risk from time in the same room as an infectious person, `p_per_hour_same_room` × hours × the airborne weight, logged as "airborne (proxy)".
  - It isn't an air model: it reads only who is in which room, so it keeps to constitution rule 4 (no air quality in v1).
  - The future air model (room air, for example Wells-Riley, which a steriliser can reduce) replaces it in the same slot.
  - **Experiments comparing sterilisers need the real air model, not the proxy:** the proxy has no ventilation or air cleaning, so a steriliser can't change it.
- **Infection state**, readable by the future air model: `{disease, exposedT, infectiousFromT, symptomaticFromT, recoveredT, isolated}` per person, each change an event with the room id, and a badge in `PersonView`.

## Deaths switch

`deaths: false` (server `DEATHS=off`) turns off deaths and end-of-life decline for the public demo. It's on by default for experiments. It's plumbed and shown in the Director panel now; it takes effect with (c).

## Sub-milestones

- **(a) Director core** (built):
  - the switch, stream, daily planning, pacing and input plumbing;
  - falls, sick calls and no-shows with cover;
  - scenario files and the validator;
  - the `inject` command, Director tab, Notable feed and log filters;
  - director-aware breach causes, the per-day report and the rates script;
  - the calendar over any year (`simDate`);
  - the director-off golden test; ADR-0005.
- **(b) Outbreaks and isolation**, with the `norovirus-outbreak` scenario.
- **(c) Illness, hospital, end of life and admissions.** It needs a cited admission rate and the reviewed admissions card first.
- **(d) Visitors' missed weeks and celebrations.**
- **(e) Tuning-debt review** against the calm-week baseline, one rule at a time (docs/12).

## Notes carried from Phase 1

- **Visitors' weeks.** Phase 1 visitors come on a weekly quota of their pattern days (docs/05 "Visiting"), so there are no random bad weeks. With the director on, (d) replaces that with explained absences (illness, holiday, family), so the log gives a reason for a quiet spell.
- **Already available to scenarios:**
  - the on-call RN coming over for serious night falls;
  - paramedics and conveyance to hospital;
  - the floating night carer's call-outs;
  - CQC Regulation 18 flags;
  - service-target breaches with causes.

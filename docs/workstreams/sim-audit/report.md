# Simulation audit: gaps where features combine

**Purpose:** a full audit of the simulation for behaviour that is unrealistic or unsafe, especially where features combine: a feature inventory, a review of every pair of features against UK care practice, new invariants checked every tick, a fuzz runner that throws random combinations of director events at the engine, and a realism review of sample days. **Report only: no behaviour has been changed.** The project owner's decisions (2026-10-01) are in section 7; the fixes follow in PRs B to F (plan.md).

> Date: 2026-10-01. Branch `sim-audit` (from `docs-phase2-wrapup`, c348d83). Not a clinical review: the guidance below is cited so the gaps can be checked, not as advice.

**What was added (tooling only):**

- `packages/sim-engine/src/safety.ts`: a safety monitor with 52 rules (the engine's 6 hard invariants plus 46 new ones). Read-only; it keeps its own memory (how long a need has been high, whether an isolated resident has been back in their room) outside the world. **It is not wired into `sim.ts`**, so every run, event log and the director-off fixture are unchanged.
- `packages/sim-engine/scripts/fuzz.ts` (`pnpm --filter @vch/sim-engine fuzz`) and `scripts/fuzz-lib.ts`: the fuzz runner, its calm baselines, shrinking, `--replay` for any saved case and `--dump` for any generated one.
- `docs/workstreams/sim-audit/cases/`: 31 named cases, one or more for each gap a rule can catch, run by `test/audit.test.ts` (each still breaks its rules until its fix flips it to `"passes"`); `docs/workstreams/sim-audit/fuzz/cases-0-2999/`: the fuzz run's summary and shrunk failing cases.

Run any case from `packages/sim-engine` (where `pnpm --filter` runs):

```sh
pnpm --filter @vch/sim-engine fuzz --replay ../../docs/workstreams/sim-audit/cases/<file>.json     # every rule it breaks, with times
pnpm --filter @vch/sim-engine sim --seed <s> --hours <h> --scenario ../../docs/workstreams/sim-audit/cases/<file>.json --report
```

Each file's `audit` block holds the gaps it shows, the rules it breaks (`rule@person`), whether it still fails, the PR that fixes it, its seed and hours, and both commands.

## Summary

- **The engine holds together.** 3,000 fuzz cases (40 seeds, 15,496 simulated days, 12,133 events, every rule checked every tick) gave no crashes, no hangs, nobody inside a wall, nobody sharing a seat or bed, no medication from anyone untrained, nobody moved before assessment, and no task left pointing at a person or task that no longer exists.
- **But it gets care wrong where features meet.** 45 gaps: **19 unsafe, 19 unrealistic, 7 cosmetic** (section 6). The 34 a rule can catch have a named scenario that runs as a test; the other 11 came from reading the code or a calm day's audit.
- **Six happen every day with no events at all** (calm weeks, director off): Raj, on a soft bite-sized diet for dysphagia, gets biscuits and toast (U14). Win, on a 1,500 ml fluid restriction for heart failure, is given about 1,650 ml (U15). Visitors follow residents into the en-suite (U13). Escorted residents walk alone while their carer waits at the destination (U16). Dennis is turned three times in 22 minutes every evening (R3). Tablets are given to sleeping residents (R6).
- **The worst combinations:**
  1. **U1.** A resident waiting for an ambulance who then falls stays on the floor indefinitely: the crew stands at the bedside for a task that never runs.
  2. **U2.** When cover leaves no woman on shift, female-only care waits for hours (Peggy: 404 minutes for the toilet). Nothing escalates it by day, and after a hospital stay Peggy needs two women at once.
  3. **U3, U4.** A lone carer is held off urgent work by a reservation for two-person care nobody can partner. Nothing is sent for, and overnight nobody owns the missed evening turn (Dennis unturned for about 6.5 hours).
  4. **U17.** The nurse ends up waiting with the first serious fall, so other fallen residents wait up to 2 hours to be assessed and for their 999 call.
  5. **U5.** A resident on the floor during a medication round gets no dose and nothing is recorded (298 fuzz cases).
- **Where it bites:** short staffing against female-only and two-person care; illness against falls; end of life against hospital, turns and the Lounge; outbreaks against visiting, admissions and end of life; isolation against visitors and celebrations.
- **Decided** (section 7, ADR-0007): visiting follows UKHSA 2024 (up to 2 visitors with an isolated resident); an advance care plan on each card; escalation for same-sex care and for a lone carer; diet, fluids and glucose modelled now; the monitor wired in as the gaps close. Fixes in PRs B to F.

## 1. Feature inventory

| Key | Feature | What it does | Code |
|---|---|---|---|
| RT | Routines | Tea on waking; morning care from each wake time (two-person care from 07:00); meals 07:30, 12:15, 17:30; drinks rounds 10:30, 15:00, 20:00 (with a biscuit, and toast or a sandwich at 20:00); bedtime care; Peggy's 2-hourly toilet prompts; comfort care for Dennis; rounds of checks at 06:40 and 20:55. Needs decay each minute; residents self-toilet or ask for help | `care.ts`, `needs.ts`, `trees.ts` |
| SF | Staffing | Early, late, night, RN day, office and reception shifts from the weekly rota; agency slots; the floor rule; staying on until relieved; the RN on call after 19:30; the floating night carer; the main-building carer for falls and uncovered nights | `rota.ts`, `floor.ts`, `float.ts`, `falls.ts` |
| BR | Breaks | One break per shift in a window, only if another carer on a shift covers the floor; the lone night carer's break during the floating carer's round | `rota.ts`, `tasks.ts` |
| HO | Handovers | 07:00, 14:00, 21:15 in the staff room with a floor cover; the 07:00 briefing; written notes when a side is missing | `rota.ts`, `trees.ts` |
| FA | Falls | The fall procedure (nearest carer, RN or phone assessment, hoist lift or 999), post-fall observations, several falls at once, help from the main building; director falls by risk and hour | `falls.ts`, `director/plan.ts` |
| SC | Sick calls | Sick calls and agency no-shows from the director or by hand | `cover.ts` |
| CV | Cover | Bank, then agency (always for a lead or the RN), then short by day or the main-building carer at night with the late carer bridging | `cover.ts` |
| IN | Infections | Courses by disease, contact and airborne-proxy spread, PPE, staff off until clear | `infection.ts` |
| OB | Outbreaks | Declared and ended per disease (norovirus, flu); Lounge closed; essential visits only; 14-day quiet period | `infection.ts`, `visitors.ts`, `lounge.ts` |
| IS | Isolation | Symptomatic residents kept in their room with PPE time on every visit | `infection.ts`, `lounge.ts`, `trees.ts` |
| IL | Illness | Mild (rest in room, hourly checks, fluids pushed, falls ×1.5) or severe (GP, ambulance) | `health.ts` |
| HS | Hospital stays | Conveyance, stay by cause, return to their own bed, care changes as overrides | `health.ts`, `falls.ts` |
| EL | End of life | A planned decline (hourly checks, family more often); the last 3 days in bed on comfort care | `health.ts`, `visitors.ts` |
| DE | Deaths | At the planned time: family told, Regulation 16 flag, room left empty, tasks closed | `health.ts` |
| AD | Admissions | A reviewed card moves into an empty room 2 to 6 weeks after a death; room set up; family added | `health.ts` |
| VI | Visitors | Weekly quota, sign-in or bell, visiting where the resident is, soft friction (lunch, personal care, falls) | `visitors.ts` |
| MW | Missed weeks | Regular visitors miss about 5 weeks a year with a seasonal cause | `director/plan.ts`, `visitors.ts` |
| CE | Celebrations | Birthdays and festivals: more family, tea and cake 15:00 to 16:00; no gathering in an outbreak | `celebrations.ts`, `lounge.ts`, `visitors.ts` |
| LO | Lounge | Bev's session, lunch, the afternoon, naps, supervision of Peggy and Stan | `lounge.ts` |
| ME | Meals | Breakfast (or breakfast first), lunch, supper, intake charts; protected lunch | `care.ts`, `trees.ts` |
| MD | Medication | Four rounds, time-critical first, interruptions raise missed doses, the on-call RN when nobody can give it | `meds.ts` |
| CH | Checks | At each resident's interval (day or night, illness, end of life, post-fall), observation by day, bedside only at night | `care.ts`, `nightcover.ts`, `trees.ts` |
| TU | Turns | Day turns (evening turns moved to 19:45), night turns on the floating carer's rounds, reservations and the turn team (ADR-0003) | `care.ts`, `float.ts`, `tasks.ts` |
| ID | Idle behaviour | Notes, tidying, restocking, sitting with someone, watching the Lounge; the floor cover's round of checks | `idle.ts` |

Rules and parameters: `data/director.json`, the 15 tuning rules in `src/tuning.ts` (docs/12), and each resident's `care` block.

## 2. Interaction review

**Method.** For each of the 276 pairs: what a UK home would do when they overlap (with guidance where it applies), then what the code does, read from the source and checked by running it (a probe, a shrunk fuzz case, or the calm baseline). Pairs where the order matters were run both ways: celebration then infection and infection then celebration (the fuzz `holiday` theme puts them the same day in either order, or a day apart), illness then fall and fall then illness, end of life then an ambulance and an ambulance then end of life, sick call then fall and fall then sick call, death then admission during an outbreak and outbreak after.

**The matrix** (upper triangle; a gap's id is listed in section 6):

- ✓: handled as practice would expect (or close enough for the model);
- ~: simplified in a way worth knowing, not a gap;
- ·: no meaningful interaction;
- U, R, C: a gap (unsafe, unrealistic, cosmetic).

| | RT | SF | BR | HO | FA | SC | CV | IN | OB | IS | IL | HS | EL | DE | AD | VI | MW | CE | LO | ME | MD | CH | TU | ID |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **RT** |  | U3 | ✓ | ✓ | ✓ | U2 U3 | U2 | ✓ | ~ | ✓ | U15 | U2 R14 | U7 U18 R8 | ✓ | R14 | U13 | · | ✓ | U16 R12 | U14 | R6 | ✓ | R3 U19 | ✓ |
| **SF** |  |  | R5 | ✓ | U17 | ✓ | U2 | U11 | ~ | ~ | · | ~ | ~ | ~ | R14 | R4 | · | ✓ | ✓ | ✓ | ✓ | ✓ | U3 | R13 |
| **BR** |  |  |  | ✓ | ✓ | R5 | · | · | · | · | · | · | · | · | · | · | · | · | ✓ | · | ✓ | ✓ | ✓ | · |
| **HO** |  |  |  |  | ✓ | ✓ | ✓ | R7 | R7 | R7 | R7 | R7 | R7 | ✓ | ✓ | · | · | · | · | · | ✓ | ✓ | U4 | ✓ |
| **FA** |  |  |  |  |  | ✓ | ✓ | ✓ | · | ✓ | U1 | U1 U17 | R2 | ✓ | ✓ | ✓ | · | · | ✓ | R9 | U5 | ✓ | ✓ | ✓ |
| **SC** |  |  |  |  |  |  | U2 R4 | U11 | ~ | · | · | · | · | · | · | R4 | · | · | ✓ | ~ | U6 | ✓ | U3 U4 | · |
| **CV** |  |  |  |  |  |  |  | R4 | ~ | · | · | · | · | · | · | R4 | · | · | · | · | ✓ | · | U3 | · |
| **IN** |  |  |  |  |  |  |  |  | ✓ | R10 | ~ | ✓ | ✓ | ✓ | U10 | U8 | ~ | U8 | U12 | ✓ | ✓ | ✓ | ✓ | ~ |
| **OB** |  |  |  |  |  |  |  |  |  | ✓ | · | ~ | U9 | ✓ | U10 | R1 U9 | ✓ | ✓ | U12 | ✓ | · | · | · | ✓ |
| **IS** |  |  |  |  |  |  |  |  |  |  | ✓ | ✓ | ✓ | · | · | U8 | · | U8 | U12 | ✓ | ✓ | ✓ | ✓ | ~ |
| **IL** |  |  |  |  |  |  |  |  |  |  |  | ✓ | R2 | · | · | · | · | ~ | ✓ | U15 | ~ | ✓ | · | · |
| **HS** |  |  |  |  |  |  |  |  |  |  |  |  | R2 | R2 | ✓ | ✓ | · | ✓ | · | ✓ | C3 | ✓ | U4 | · |
| **EL** |  |  |  |  |  |  |  |  |  |  |  |  |  | R2 | ✓ | U9 | ✓ | ✓ | U18 | R8 | R11 | ✓ | U7 | · |
| **DE** |  |  |  |  |  |  |  |  |  |  |  |  |  |  | U10 | C1 | ✓ | ✓ | C6 | ✓ | ✓ | ✓ | ✓ | ✓ |
| **AD** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| **VI** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ |
| **MW** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ | · | · | · | · | · | · |
| **CE** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ | ~ | · | · | · | · |
| **LO** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ | ✓ | ✓ | · | ✓ |
| **ME** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ | ✓ | · | · |
| **MD** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ | ✓ | · |
| **CH** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ | ✓ |
| **TU** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| **ID** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

Of the 276 pairs: 68 have a gap, 17 are simplified, 111 are handled and 80 don't interact. Some gaps (R15, R16, R13, C5, C7) belong to one feature, not a pair, so they aren't in the matrix.

**The pairs that matter**, with what practice expects and what the code does:

| Pair | What a UK home would do | What the code does | Verdict |
|---|---|---|---|
| Illness × falls (illness first) | One 999 call, updated with the fall; the resident is never left on the floor | The fall resets the ambulance task, which never runs again; the crew waits at the bedside for good | **U1** |
| Falls × illness (fall first) | GP or 999 decided after the fall is dealt with | The GP waits while they're on the floor, then calls the ambulance | ✓ |
| Falls × falls (several at once) | The nurse triages, 999 for each serious fall, a carer stays with each | The nurse stays with the first serious fall; others wait up to 2 h; one crew in turn | **U17, R17** |
| Falls × medication (fall during a round) | Round paused; their dose given once they're up, or the omission recorded | Paused and resumed ✓, but the fallen resident's dose is skipped with no record | **U5** |
| Falls × meals/drinks | Nothing by mouth until assessed | Drinks topped up or left beside them on the floor | **R9** |
| Falls × checks | Post-fall observations | 30-minute checks for 4 hours | ✓ |
| Falls × end of life | Follow the advance care plan; hospital only if it says so | 999 for a serious fall regardless of the decline | **R2** |
| End of life × illness (illness first) | A planned decline cancels the GP's admission (ReSPECT) | The ambulance already called still comes; they go to hospital | **R2** |
| End of life × illness (decline first) | No new admission plan | New illness refused ("on end-of-life care") | ✓ |
| Hospital × end of life (away when death is due) | Death in hospital, or a planned transfer home | Death clock runs on; they die the minute they're back | **R2** |
| Hospital × routines (back after a serious fall) | Reassessment; care plan changed with the family | Two carers for personal care, for good; with female-only care that needs two women | **U2, R14** |
| End of life × turns | Turns with pad changes are intimate care: same-sex rules apply; two staff in bed | Turns go to anyone; in-bed care stays single-handed | **U7** |
| End of life × Lounge (decline begins while out) | Helped back to bed when ready | Put straight into bed, then walked back out by a queued Lounge trip | **U18** |
| End of life × meals | Comfort feeding from when the plan changes | A breakfast already queued is served | **R8** |
| End of life × visitors | Family welcome at any time | Daily, later and longer visits | ✓ |
| Outbreak × end of life | End-of-life visits continue (UKHSA 2024) | Cancelled unless the card says "end of life" (Dennis only) | **U9** |
| Outbreak × visitors | Visiting continues with precautions; restriction only exceptional (UKHSA 2024, Reg 9A) | All visits cancelled except Dennis's | **R1** |
| Outbreak × admissions (death, then outbreak, then admission) | Closed to admissions (norovirus); risk-assessed (flu) | Admits as planned | **U10** |
| Outbreak × Lounge | Communal activities reduced; the Lounge cleared | Trips stop, but dozing or busy residents stay in it 30+ min | **U12** |
| Outbreak × celebrations (outbreak first) | No party; essential visits | No gathering, no extra visits | ✓ |
| Celebrations × infection (party first, infection the same day) | Tea goes ahead without the ill resident; their visitors limited | The isolated resident's whole family comes to their room; if the second case declares an outbreak during tea, the session carries on until its residents are walked back | **U8**, ~ |
| Isolation × visitors (no outbreak) | In-room visits with precautions, numbers risk-assessed | No limit: groups of 3 to 5 | **U8** |
| Isolation × Lounge | Taken back to their room at once | Waits until they're free; 20 to 35 min | **U12** |
| Isolation × checks, meals, medication, turns | In their room, with PPE | All in the room, +3 min PPE each visit | ✓ |
| Infection × isolation length (flu) | At least 5 days from onset (UKHSA 2024) | 24 h after symptoms end: 4 to 5 days for short courses | **R10** |
| Infection × staffing (symptoms at work) | Stop and go home as soon as safe; no hands-on care | Finish the task and wait for cover; symptoms on arrival missed entirely | **U11** |
| Infection × cover (office staff ill) | Manager's or receptionist's duties redistributed | A bank or agency carer booked "for the office" | **R4** |
| Sick call × cover × female-only care | Book a woman, or escalate | Gender ignored; nothing escalates by day | **U2** |
| Sick call × turns and two-person care (lone carer) | Help from another unit or the on-call manager | Reservation blocks the lone carer; nothing sent for | **U3** |
| Sick call × turns × night (evening turn missed) | Night staff pick it up at once | Owned by nobody until the next planned round | **U4** |
| Sick call × breaks | A break covered by another unit if needed | No break | **R5** |
| Sick call × medication (Parkinson's) | Within 30 minutes | Late only after 60 | **U6** |
| Routines × turns (evening crunch) | One turn before the busy hour | Three in 22 minutes | **R3** |
| Routines × visitors | Visitors wait outside during personal care and toileting | Wait for washes, turns and helped toileting, but follow into the en-suite for unaided toileting | **U13** |
| Routines × meals (diet, fluids) | Texture and fluid limits from the care plan | Not read | **U14, U15** |
| Routines × Lounge (escort) | Walk beside them | Carer walks ahead | **U16** |
| Routines × medication (bedtime) | Not given asleep | Given asleep | **R6** |
| Handovers × infection, illness, end of life, hospital | Leads the handover | Not in the summary | **R7** |
| Deaths × visitors | Family arriving are met by staff | A visit "starts" with someone who has just died | **C1** |
| Missed weeks × end of life, celebrations | Family don't go away at the end; a family away misses the party | Both handled | ✓ |
| Admissions × visitors, routines, rounds | New family, new card | All from the card | ✓ (but **R14**) |
| Breaks × falls, Lounge, turns | Called back, staggered | Paused and resumed; wait for turns | ✓ |
| Handovers × falls, short staffing | Floor cover; written notes | Handled | ✓ |
| Idle × everything | Dropped for real work | Dropped at once | ✓ |

## 3. New invariants

`createSafetyMonitor()` in `src/safety.ts`. Call `check(world, events)` after every `step()`; it returns every rule failing now, keyed so a caller can log each one once when it starts (as `logInvariants` does). The ones asked for are marked ★; the rest came out of the interaction review.

| Rule | Severity | Fails when | |
|---|---|---|---|
| `floor_cover` | unsafe | No on-duty care staff on the floor | engine |
| `standing_spot` | integrity | Two stationary people share a grid cell | ★ engine |
| `two_person` | unsafe | Two-person care performed with fewer than two staff at the resident | engine |
| `rn_reachable` | unsafe | No RN on the wing and none on call | engine |
| `fall_unattended` | unsafe | A fallen resident with nobody attending and no help asked for | engine |
| `no_visitors_in_staff_room` | integrity | A visitor in the staff room | engine |
| `isolated_visitors_over_limit` | unsafe | An isolated resident (not at the end of life) has more visitors with them at once than the limit (ECS_LIMIT, 2) | ★ |
| `isolated_in_lounge` | unsafe | An isolated resident is in the Lounge (after 20 minutes' grace to be walked back) | ★ |
| `isolated_left_room` | unsafe | An isolated resident is outside their own room (after being back in it, or 30 minutes after isolation began) | ★ |
| `outbreak_lounge_use` | unsafe | The Lounge is used during an outbreak (a resident there 30 minutes after it was declared, or an activity started) | ★ |
| `isolation_too_short` | unrealistic | A resident with flu came out of isolation less than 5 days after their symptoms began (UKHSA 2024: a minimum of 5 days) |  |
| `admission_during_outbreak` | unsafe | A new resident moved in while an outbreak was on |  |
| `sick_staff_on_wing` | unsafe | A member of staff with symptoms is on the wing more than 60 minutes after they began, or starts a shift while excluded | ★ |
| `sick_staff_giving_care` | unsafe | A member of staff with symptoms is giving resident care more than 5 minutes after they began | ★ |
| `eol_visit_cancelled` | unsafe | A visit to a resident at the end of their life was cancelled or cut short for an outbreak |  |
| `ecs_visit_cancelled` | unrealistic | A resident's next of kin turned away by a blanket outbreak restriction (UKHSA 2024: visits should not normally be restricted; Regulation 9A) |  |
| `visitor_in_ensuite` | unsafe | A visitor is in a resident's en-suite |  |
| `care_for_absent_resident` | integrity | Care, a meal, a check, a dose or a visit logged for a resident in hospital or who has died | ★ |
| `task_for_absent_resident` | integrity | A task exists for a resident in hospital or who has died | ★ |
| `absent_resident_state` | integrity | A resident off the wing is still on the floor, busy or asking for help, or visitors stay with nobody to see |  |
| `female_only_by_man` | unsafe | Personal care for a resident with female carers only, done with a man | ★ |
| `meds_trained` | unsafe | Medication given by someone not meds-trained |  |
| `fall_moved_before_assessment` | unsafe | A fallen resident moved before they were assessed |  |
| `long_lie` | unsafe | A resident on the floor after a fall for more than 2 hours (a long lie) |  |
| `time_critical_dose_late` | unsafe | A time-critical dose (Parkinson's) given more than 30 minutes late, or missed |  |
| `dose_skipped_unrecorded` | unsafe | A round finished with a resident on the wing given no dose and nothing recorded (not given, not missed) |  |
| `fluid_limit_exceeded` | unsafe | A resident on a fluid restriction (heart failure) given more than their daily limit |  |
| `diet_texture` | unsafe | A resident on a soft, bite-sized diet (IDDSI 6, dysphagia) given a biscuit, toast or a sandwich |  |
| `request_from_nonrequester` | integrity | A resident whose card says they can't ask for help asked for help |  |
| `meal_for_comfort_only` | integrity | A meal served to a resident on comfort feeding only |  |
| `bed_bound_out_of_bed` | unsafe | A bed-bound resident out of bed (not after a fall) |  |
| `seated_too_long` | unsafe | A resident who can't change position themselves (hoisted) sitting out of bed more than 6 hours at a stretch (NICE CG179: at least every 6 hours if at risk) |  |
| `escort_apart` | unsafe | A resident walked by a carer (an escort) is walking with the carer more than 2 m away |  |
| `need_unmet_staff_idle` | unsafe | A resident's hunger, thirst or toileting over 0.9 for more than an hour while enough carers who could help are idle | ★ |
| `request_unanswered_2h` | unsafe | A resident's request for help not started 2 hours after they asked (the target is 30 minutes) |  |
| `no_woman_for_female_only` | unsafe | Female-only personal care waiting over an hour with no woman on shift on the wing |  |
| `eol_conveyed_to_hospital` | unrealistic | A resident on a planned end-of-life decline taken to hospital |  |
| `died_on_return` | unrealistic | A resident died within 2 hours of coming back from hospital |  |
| `death_not_in_bed` | unrealistic | A resident died out of bed |  |
| `no_break` | unrealistic | A member of staff worked a shift over 6 hours with no break (Working Time Regulations: 20 minutes) |  |
| `office_covered_by_carer` | unrealistic | An office or reception shift (manager, activities, receptionist) was covered by a bank or agency carer |  |
| `lone_carer_two_person_due` | unsafe | By day, two-person care waiting over an hour with only one carer on the wing and no help sent for |  |
| `excessive_hours` | unsafe | A member of staff on the wing more than 14 hours at a stretch, or back with under 11 hours' rest |  |
| `turn_repeated` | unrealistic | A resident turned again less than an hour after their last turn |  |
| `meds_while_asleep` | unrealistic | Tablets given to a resident who is asleep |  |
| `drink_for_fallen` | unrealistic | A drink served or left for a resident lying on the floor after a fall |  |
| `asleep_on_floor` | unrealistic | A resident asleep on the floor after a fall |  |
| `shared_seat` | integrity | Two people sitting on the same seat, or two residents in one bed | ★ |
| `off_walkable` | integrity | Someone off walkable floor (inside a wall or furniture) or in the wrong room for where they stand | ★ |
| `orphan_task` | integrity | A task, fall log, ambulance call or assignment left pointing at something that no longer exists |  |
| `stuck_external` | integrity | Paramedics or the on-call RN left on the wing with nothing to do |  |
| `float_overstay` | unrealistic | The floating night carer (shared with the main building) on the wing more than 4 hours at a stretch |  |

Severity in the monitor: *unsafe*, *unrealistic*, or *integrity* (bookkeeping that would leave someone stuck); section 6 sorts every gap into unsafe, unrealistic or cosmetic by what it means for a resident.

**Two rules added after the first report** (2026-10-01): `escort_apart` (U16) and `seated_too_long` (U19), so every unsafe gap has a rule a test can run.

**Not wired into the engine yet, on purpose.** Adding them to `logInvariants` would emit `invariant.violated` in runs where they fire (every calm day, for the diet and fluid rules), which changes event logs and the director-off fixture. Wiring them in is a one-line change once the gaps they find are fixed or accepted; some (the visitor limit, the diet rule) need a decision first (section 7).

**Decisions behind the rules:**

- **The visitor limit for an isolated resident is 2** (`ECS_LIMIT`, decision 1). The current UKHSA guidance sets no number: visits go ahead in the resident's room with precautions. It moves to `data/director.json` with the visiting changes (PR E). (The first fuzz run used 1.)
- **A long lie is 2 hours**, not the usual 1, because the model's ambulances take 30 to 90 minutes by design.
- **Unmet needs** count only when enough idle carers who could help were on the wing (two for Raj's and Dennis's pad changes, women for Peggy's and Kamala's toileting).

## 4. Random stress testing

`scripts/fuzz.ts`. Case *i* is generated from its own seeded stream (`createRng("fuzz-i")`), so any case can be rebuilt exactly (`fuzz --dump i`).

**What it generates.** Each case picks a seed (1 to 40), a length, and one of ten themes:

| Theme | Cases | What it throws at the wing |
|---|---|---|
| cluster | 438 | 2 to 5 events in the same minute, at an awkward time (06:40 to 07:15 handover, 07:58 to 08:05 medication round, 12:15 lunch, 13:00 round, 14:00 handover, 15:00 tea, 20:55 to 21:30, 02:00 and others), sometimes one more within 90 minutes |
| back_to_back | 338 | 3 to 6 events 1 to 20 minutes apart from an awkward time |
| outbreak | 360 | 1 or 2 infections (often enough to declare), then falls, a decline, celebrations, an admission, illness, sick calls during it; 5 days |
| short_staffed | 249 | 1 to 3 sick calls or no-shows (cover auto, bank, agency or none), then falls, illness, infection or a celebration on the same shifts |
| eol_chain | 281 | A 1 to 2 day decline and a death, an admission 3 to 4 days in, other events around them; 5 or 7 days |
| holiday | 280 | A birthday or Christmas and an infection, in either order, the same day or a day apart |
| illness_mix | 249 | Severe illness (GP, ambulance) with a fall, a decline, an infection or another illness close behind, often the same resident; 3 or 10 days |
| hospital_return | 239 | A serious fall or severe illness on day one, then infections, a decline, celebrations, falls, sick calls while they're away and when they're back; 12, 16 or 21 days |
| night | 286 | An uncovered or no-show night, the night carer taken ill, then falls, illness or a decline in the small hours |
| random_plus | 280 | The random director on, plus 2 to 4 scripted events; 7 days |

Every case is checked by `validateScenario` before it runs. Inputs that can't apply are skipped and logged as the engine does (2,061 of 12,133, mostly a sick call for someone with no planned shift, or an event for someone in hospital or who has died).

**How a case passes or fails.** Every tick: `checkInvariants` (through the monitor) and every monitor rule. For each seed used, the same length is run with no events (calm) and with the random director alone; a case **fails** only on a rule-and-person its seed's baselines don't break. The failing cases are then shrunk: events dropped one at a time while the same rule and person still fail, and the run cut to an hour after the first failure. Two per rule are saved as scenario files.

**Results** (2026-10-01, re-run for PR A with the visitor limit at 2, the two new rules, and baselines that keep examples per person; 3,000 cases, 40 seeds, 15,496 simulated days, about 7 minutes on 10 processes):

- **0 crashes, 0 hangs** (a job over 20 minutes is retried once on a fresh process; none needed it).
- **Never broken:** `floor_cover`, `standing_spot`, `rn_reachable`, `fall_unattended`, `no_visitors_in_staff_room`, `meds_trained`, `fall_moved_before_assessment`, `shared_seat`, `off_walkable`, `orphan_task`, `task_for_absent_resident`, `request_from_nonrequester`, `death_not_in_bed`, `asleep_on_floor`. (`two_person` fired 5 times, all false alarms, C4.)
- **Broken in the calm baselines too** (8 seeds × 28 days, calm and random director; so every day, not a combination): `diet_texture`, `fluid_limit_exceeded`, `meds_while_asleep`, `turn_repeated`, and the two rules added after the first report, `escort_apart` and `seated_too_long` (all 16 runs); `visitor_in_ensuite` (12 of 16). The random director alone also produced `no_woman_for_female_only` (3 of 8 seeds), `request_unanswered_2h`, `need_unmet_staff_idle`, `no_break` (2 of 8) and `isolation_too_short` (1).
- **New failures, by rule** (cases out of 3,000; the gap in section 6):

| Rule | Cases | Mostly in | Gap |
|---|---|---|---|
| `ecs_visit_cancelled` | 585 | outbreak, holiday | R1 |
| `turn_repeated` | 614 | eol_chain, cluster | R3 |
| `drink_for_fallen` | 341 | cluster, illness_mix | R9 |
| `dose_skipped_unrecorded` | 298 | cluster, hospital_return | U5 |
| `visitor_in_ensuite` | 296 | hospital_return, eol_chain | U13 |
| `no_break` | 258 | short_staffed | R5 |
| `isolated_visitors_over_limit` | 139 | holiday, outbreak | U8 |
| `female_only_by_man` | 167 | eol_chain | U7 |
| `no_woman_for_female_only` | 165 | eol_chain, outbreak, short_staffed | U2 |
| `time_critical_dose_late` | 157 | outbreak | U6 |
| `lone_carer_two_person_due` | 122 | short_staffed, outbreak | U3 |
| `need_unmet_staff_idle` | 120 | outbreak | U3, U2 |
| `eol_visit_cancelled` | 95 | outbreak | U9 |
| `office_covered_by_carer` | 81 | illness_mix | R4 |
| `request_unanswered_2h` | 78 | outbreak | U2 |
| `isolation_too_short` | 69 | outbreak | R10 |
| `sick_staff_on_wing` | 66 | outbreak, night | U11 |
| `sick_staff_giving_care` | 65 | outbreak | U11 |
| `meds_while_asleep` | 131 | outbreak, back_to_back | R6 |
| `isolated_left_room` | 46 | holiday, outbreak | U12 |
| `isolated_in_lounge` | 36 | holiday, outbreak | U12 |
| `outbreak_lounge_use` | 32 | holiday, outbreak | U12 |
| `eol_conveyed_to_hospital` | 30 | cluster, night, back_to_back | R2 |
| `excessive_hours` | 28 | illness_mix | U1, R19 |
| `absent_resident_state` | 25 | back_to_back | C2 |
| `long_lie` | 20 | cluster, illness_mix | U1, U17 |
| `meal_for_comfort_only` | 20 | eol_chain | R8 |
| `float_overstay` | 14 | illness_mix, hospital_return | R18 |
| `stuck_external` | 14 | illness_mix | U1 |
| `admission_during_outbreak` | 13 | eol_chain | U10 |
| `two_person` | 5 | hospital_return | C4 |
| `care_for_absent_resident` | 3 | eol_chain | C1 |
| `died_on_return` | 2 | illness_mix | R2 |
| `bed_bound_out_of_bed` | 1 | eol_chain | U18 |

Run it again:

```sh
pnpm --filter @vch/sim-engine fuzz --cases 3000 --workers 10                 # writes docs/workstreams/sim-audit/fuzz/cases-0-2999/
pnpm --filter @vch/sim-engine fuzz --baseline --seeds 1-8 --days 28          # rules broken with no events
pnpm --filter @vch/sim-engine fuzz --dump 253 > /tmp/case-253.json           # any case as a scenario file
```

Wrap long runs in `caffeinate -i` on a Mac: a laptop asleep stops the runs but not the hang timer.

## 5. Realism review

**Samples read in full:** two calm days on seed 1 (`sim --audit`, every resident's day, every shift, morning care order and the rounds); a week of the `norovirus-outbreak` scenario on seed 2 (`--report`); a short-staffed Friday from the random director (seed 1, 20 November); a lone late shift (seed 3); and the event logs behind every shrunk fuzz case. Compared with UK practice as described in docs/05 and the guidance in the sources.

**What looks right:**

- The shape of the day: handovers at the overlaps with floor cover, four rounds with the time-critical medicine first, breakfast to supper, drinks rounds with a supper snack, bedtime staggered by routine, hourly night checks for Peggy, Stan and Dennis and Arthur's 4-hourly by choice.
- Falls by day and night, post-fall observations, family told, CQC Regulation 18 flagged.
- Outbreaks declared and ended per disease as the guidance has it; staff excluded until clear.
- Rounds take about 20 minutes; the 08:00 round starts on time; breaks are staggered.

**What looks wrong, even where no rule is broken** (all in section 6):

- **People:** Arthur, who has capacity and is independent, gets daily morning care (R15). Stan never wanders or hallucinates; sundowning only moves falls (R15). Raj sits 12.5 hours in his wheelchair (U19). Raj and Dennis never leave their rooms; evenings and two meals are in bedrooms (R12). Dennis is "weeks from death" for about a year (R16).
- **Care:** escorted walks are walked alone (U16). Three turns in 22 minutes every evening (R3). Diet texture and fluid limits are ignored (U14, U15). Tablets are given asleep (R6). Win's glucose check isn't done (R15).
- **Staff:** the day team is generous and idle a third or more of the time (R13), yet a single absence leaves a lone carer with no route to help, no break and two-person work undone (U3, U4, R5). Gender is ignored in cover (U2). Office absences are filled by carers (R4).
- **Joining and leaving:** new residents and returns from hospital appear with nobody receiving them, and the GP is consulted at 03:34 (R14). A death leaves an empty room with no verification and no family met (C1, and docs/12).
- **Handovers** carry no infection, illness or end-of-life information (R7).

## 6. Gaps by severity

Each gap: what happens, why (the code), what practice expects, how often, and the named case that reproduces it (`cases/`, run by `test/audit.test.ts`; the fuzz run's own shrunk cases are in `fuzz/cases-0-2999/cases/`). Counts are fuzz cases out of 3,000 that broke the rule where the seed's calm baseline didn't, unless marked "every calm day".

### Unsafe

**U1. A fall while the ambulance for an illness is on its way leaves the resident on the floor for good.**
- Dennis's severe chest infection gets an ambulance (11:45). He falls (serious) at 11:58. The fall resets the open `hospital_transfer` task (`injectFall` resets every active task of the resident), and nothing runs an open transfer again (`runTasks` only ticks active tasks). The crew answers that call first, walks to the bedside and waits there for good; the fall's own crew call queues behind it. Dennis lies on the floor from 11:58 for the rest of the run, his carer (Tom) stays with him well past the end of his shift (14 hours on the wing), the on-call RN stays, and his 13:00, 17:00 and 21:00 doses are skipped with nothing recorded.
- Practice: one 999 call with the new information; a long lie (an hour or more on the floor) is itself a serious harm.
- **The engine's own checks don't see it:** `sim --report` on this run gives 0 hard violations and 1 service breach.
- Fuzz: `long_lie` 20, `stuck_external` 14, `excessive_hours` 28 (most of them this).
- Case: `cases/illness-ambulance-then-fall.json`.

**U2. Cover can leave no woman on shift, and female-only care then waits for hours.**
- The cover rule picks agency workers from the pool regardless of gender (`cover.ts` `bookCover`); the rota's "a woman on every shift" holds only for the planned rota. On seed 1 (random director, 20 November), Shanice is off sick; the agency carer and the agency nurse are both men, and Dave leads. From 14:40 to 21:30 there is no woman on the wing, and Peggy (female carers only) waits **404 minutes** for the toilet, her need at its maximum for 6 hours. Nothing escalates it: the floating carer and the main building are night-time help only, and the manager (a woman, on the wing until 17:00) isn't care staff in the model.
- Worse after a hospital stay: a serious fall makes personal care two-person for good, so Peggy then needs **two women at once**. At night that means Lorna plus a female night carer; in fuzz case 13 her toilet requests wait 2 hours or more on several days (399 minutes one Sunday afternoon) and Lorna stays over 4 hours on three nights (`float_overstay`).
- Practice: CQC Regulation 10 (dignity) and Regulation 9 (person-centred care): a documented same-sex care preference is part of the care plan; when a shift can't meet it, the home books a woman or escalates.
- Fuzz: `no_woman_for_female_only` 165 (and 3 of 8 random-director baselines), `request_unanswered_2h` 78, `float_overstay` 14.
- Cases: `cases/random-seed-1-female-only.json`, `cases/lone-carer-then-male-night.json`, `cases/peggy-two-women-after-fall.json`.

**U3. A lone carer is held off urgent work by a two-person reservation nobody can partner, and nothing is sent for.**
- Thursday's late CA doesn't come and nobody covers (seed 3). From 19:30 Kasia is the only carer. She reserves Dennis's two-person turn (ADR-0003: a waiting two-person task is reserved for its one free candidate, who then does only short work); there is no partner on the wing, so the reservation never lapses. It keeps her off Peggy's toilet request for 95 minutes while she writes notes and tidies. Raj's hoisted bedtime and Dennis's turn wait over an hour with nobody sent for: by day there is no route to the main building or the floating carer for two-person care.
- Practice: a lone worker on a unit with a hoisted resident and a 2-hourly turn would be unsafe staffing (Regulation 18); the home would get help from another unit or the on-call manager.
- Fuzz: `lone_carer_two_person_due` 122, `need_unmet_staff_idle` 120.
- Cases: `cases/lone-late-carer.json`, `cases/lone-carer-then-male-night.json`.

**U4. A turn missed in the evening belongs to nobody overnight.**
- In the same case, Dennis's 19:45 turn can't be done by a lone carer. At 21:30 the night staff arrive, but the floating carer only plans turns *due* from 21:30 (`float.ts` `floatCovers`), this one was due before, and she is never called out for a turn, only for toileting. The open turn sits reserved by the lone night carer. Dennis goes from 19:26 to after 02:00 unturned, his toileting need at its maximum (a soiled pad) from about 23:00.
- Practice: NICE CG179: adults at high risk of pressure ulcers should change position at least every 4 hours (Dennis's plan: every 2).
- Case: `cases/lone-carer-evening-turn.json`.

**U5. A resident on the floor during a medication round gets no dose and nothing is recorded.**
- `meds.ts` `giveMeds` skips anyone off the wing **or on the floor** ("not given on this round") with no `med.missed`, no reason, and never comes back to them. A minor fall at 08:01 means no 08:00 dose at all.
- Practice: NICE SC1 (Managing medicines in care homes): record when and why a medicine wasn't given; a blank on the MAR chart is treated as an error. A dose delayed by a fall would be given once the resident is up, or the omission recorded and escalated.
- Fuzz: `dose_skipped_unrecorded` 298.
- Case: `cases/fall-during-round.json`.

**U6. Arthur's time-critical Parkinson's medicine counts as late only after 60 minutes.**
- `meds.ts` uses one 60-minute "late" threshold for everyone. Arthur is first on each round, but if he's busy he is moved to the end; interruptions (falls, short staffing) push his doses 35 to 50 minutes late or make them missed.
- Practice: NICE NG71 and quality standard QS164 (statement 4): levodopa within 30 minutes of the individually prescribed time, in hospital or a care home.
- Fuzz: `time_critical_dose_late` 157.
- Case: `cases/time-critical-late.json`.

**U7. In the last days, turns (which include a pad change) aren't female-only, so men turn Peggy and Kamala.**
- `lastDays` makes the resident bed-bound with 2-hourly turns; `createCare` marks only morning, bedtime and pad-change care as personal, so turns go to anyone. Turns also include a pad change (`careEffects`). Separately, a resident who becomes bed-bound keeps `personal_care_staff: 1`, so in-bed pad changes and washes are done single-handed (Dennis's plan has two).
- Practice: as U2; moving and handling a bed-bound person in bed is normally two staff.
- Fuzz: `female_only_by_man` 167.
- Case: `cases/men-turn-peggy.json`.

**U8. An isolated resident gets every visitor at once when no outbreak has been declared, and a celebration brings the whole family.**
- Visiting is restricted only during a declared outbreak (`visitors.ts`). A single isolated case (flu or norovirus) gets their usual visitors together: Raj up to four (Harpreet with Simran, Arjun and Priya), and on Christmas Day Stan three. A birthday or festival brings everyone into the isolation room, while tea goes ahead in the Lounge without them.
- Practice: UKHSA's ARI guidance (2024): visits to an isolating resident go ahead, in their room, with precautions; the number is a local risk assessment. The project's limit is 1 for now (section 7).
- Fuzz: `isolated_visitors_over_limit` 139 at the limit of 2 (174 at 1), most in the celebration theme.
- Case: `cases/christmas-isolation-visitors.json`.

**U9. During an outbreak, visits to a dying resident are cancelled unless their card says "end of life".**
- `essentialVisit` (`infection.ts`) reads the card's conditions, so only Dennis counts. A decline started by the director (Win, Peggy, Stan) isn't essential, and their family are turned away every day of the outbreak.
- Practice: UKHSA, *Supporting safer visiting in care homes during infectious illness outbreaks* (2024): end-of-life visits should be facilitated "even in exceptional circumstances".
- Fuzz: `eol_visit_cancelled` 95.
- Case: `cases/outbreak-eol-visits.json`.

**U10. A new resident moves in during an outbreak.**
- `admit` and the admission planned after a death don't check for an outbreak.
- Practice: a norovirus outbreak closes the home to admissions (Norovirus Working Party 2012; local IPC teams); for respiratory outbreaks, UKHSA says closure to admissions "may be considered" with the health protection team.
- Fuzz: `admission_during_outbreak` 13.
- Case: `cases/outbreak-admission.json`.

**U11. Staff with symptoms keep working.**
- Symptoms starting during the 5 to 15 minutes between arriving and the shift starting are missed entirely: `sendHomeSick` needs a started shift and `excludeUpcoming` skips shifts already under way. Blessing's flu starts at 06:52 as she arrives; she works the whole early shift, doing checks, morning care and a turn, and passes it to Maria.
- At other times, a carer taken ill finishes what they're doing and waits for floor cover, giving care in the meantime. A night carer taken ill stays (and works) until the main-building carer arrives 1 to 2 hours later.
- Practice: UKHSA (ARI outbreaks): staff who become unwell should leave work as soon as it is safe to do so; norovirus guidance is to stop work immediately and stay off until 48 hours symptom-free. At night someone comes in, but the ill carer stops hands-on care.
- Fuzz: `sick_staff_on_wing` 66, `sick_staff_giving_care` 65.
- Cases: `cases/symptoms-on-arrival.json`, `cases/night-carer-ill.json`, `cases/sick-carer-gives-care.json`.

**U12. Isolated residents stay in the Lounge, and the Lounge stays in use when an outbreak closes it.**
- Residents are moved only when "free" (`lounge.ts`: not asleep, not busy): someone dozing in an armchair, or waiting for an escort, stays. An isolated resident can still be in the Lounge 20 to 35 minutes after symptoms begin, and isolated residents are seen in the corridor on the way back. Residents remain in a "closed" Lounge 30 minutes and more into an outbreak.
- Practice: a symptomatic resident is taken back to their room straight away; the Lounge is cleared when communal activities are stopped.
- Fuzz: `isolated_left_room` 46, `isolated_in_lounge` 36, `outbreak_lounge_use` 32.
- Cases: `cases/isolated-in-lounge.json`, `cases/isolated-left-room.json`, `cases/outbreak-lounge.json`.

**U13. Visitors follow residents into the en-suite.**
- A visitor goes to wherever the resident is (`visitors.ts` `spotBy` returns the resident's point). If that's the toilet, they walk into the en-suite and stand beside it (non-residents are put on `WC.Stand`).
- Practice: CQC Regulation 10 (dignity, privacy).
- Every calm week on 6 of 8 seeds; fuzz 296.
- Case: `cases/calm-seed-3.json`.

**U14. Raj, on a soft, bite-sized diet for dysphagia, is given biscuits, toast and a supper sandwich.**
- The drinks rounds give everyone awake a biscuit (10:30, 15:00) and toast or a sandwich (20:00); early risers get tea and toast. Nothing reads `nutrition.diet`.
- Practice: IDDSI level 6 excludes dry biscuits and toast (a choking risk); CQC Regulation 14 (nutrition and hydration).
- Every calm day.
- Case: `cases/calm-seed-1.json`.

**U15. Win's 1,500 ml fluid restriction (heart failure) is never applied.**
- `fluid_limit_ml` is on her card and in docs/05 but no code reads it. She's given about 1,650 ml on a normal day, more when ill ("a drink at every contact").
- Practice: a fluid restriction is a prescribed part of the care plan, with a chart against it.
- Every calm day.
- Case: `cases/calm-seed-1.json`.

**U16. Escorted residents walk alone: the carer goes on ahead at their own speed.**
- Every walk is each person going to the point at their own speed (`goTo`): carers 1.2 m/s, Peggy 0.4, Stan 0.6. On a calm day, during escorted walks the carer is more than 1.5 m away 74% of the time and already standing at the destination 57% of the time, up to 12 m ahead. Peggy (zimmer frame) and Stan (Lewy body dementia) are escorted because of their high falls risk. (In the model falls are drawn by the director, so this doesn't change how often they fall.)
- Practice: standby assistance means walking beside the resident.
- Every calm day.
- Case: `cases/calm-seed-1.json`.

**U17. The nurse ends up waiting with the first serious fall, so other falls wait to be assessed and for 999.**
- In a cluster (seed 18, 13:00, three falls, two serious), Maria reaches Arthur first, so she is the one who stays with him for his ambulance (`dial 999` keeps `staff[0]`). As the only assessor on the wing, Dennis waits 1¾ hours on the floor to be assessed and Win (serious) waits **2 hours** before anyone calls 999 for her. By day the on-call RN isn't asked for, and one ambulance crew answers all calls in turn (R17), so the third fall waits longest.
- Practice: the nurse triages, calls 999 for every serious fall at once, and leaves a carer with the first.
- Fuzz: `long_lie` (cluster theme) and the falls cases above.
- Case: `cases/three-falls-at-lunch.json`.

**U18. When the last days begin, the resident is put straight into bed from wherever they are, and a queued Lounge walk then takes them out again.**
- `lastDays` calls `getIntoBed` at once, so Peggy goes from the corridor to her bed with nobody helping. The "walk to the Lounge" already queued isn't cancelled, so six minutes later a carer gets her out of bed and walks her, now bed-bound and dying, to the TV. Her 2-hourly toilet prompts also continue (`prompted_toileting_hours` stays on the card).
- Fuzz: `bed_bound_out_of_bed` 1.
- Case: `cases/last-days-lounge-walk.json`.

**U19. Raj sits in his wheelchair for about 12.5 hours a day with no change of position.**
- Hoisted to his wheelchair after morning care (07:30) and back to bed at 20:00; his card has no day repositioning and he naps in the chair. (Found in the realism review: not a rule on his card.)
- Practice: NICE CG179: at risk adults change position at least every 6 hours (4 if high risk); a stroke survivor who can't move himself would usually have a rest on the bed after lunch.
- Every calm day.

### Unrealistic
- Case: `cases/calm-seed-1.json`.

**R1. Outbreaks cancel every visit except Dennis's.** `visitors.ts` cancels or ends all non-essential visits for the whole outbreak. UKHSA's 2024 visiting guidance says there "should not normally be any restrictions", that any restriction must be exceptional, proportionate and time-limited, and Regulation 9A protects visiting. Fuzz `ecs_visit_cancelled` 585 (each a next of kin turned away). Case: `cases/outbreak-visits-cancelled.json`.

**R2. A dying resident is taken to hospital, then dies the minute they're back.** Starting a decline doesn't cancel an ambulance already called for an illness (it only clears `illness`), and a serious fall in the last days goes to 999 like any other. In hospital the death clock runs on, so they die as they arrive back (`healthMinute`: return, then the death check, in the same minute). Practice: NICE NG31 and NG142: an advance care plan (often a ReSPECT form) records the preferred place of death and when to treat in hospital. Fuzz `eol_conveyed_to_hospital` 30, `died_on_return` 2. Case: `cases/end-of-life-then-hospital.json`.

**R3. Dennis is turned three times in 22 minutes every evening.** The evening-crunch tuning rule (`care.ts` `dayTurnTime`) moves any turn due 20:00 to 21:30 back to 19:45, even one only just done: turns at about 19:25, 19:36 and 19:47 every day on every seed. Each is two carers for 10 minutes in the busiest hour, and a turn is disruptive for a dying man. The same happens to anyone in their last days (`turn_repeated` 614). Case: `cases/calm-seed-1.json`.

**R4. An office or reception absence is "covered" by a bank or agency carer.** `bookCover` treats `office` and `reception` like a care-assistant slot: Shanice is booked for Joanne's manager shift, an agency carer for Sanjay's desk. They then work as an extra carer, nobody is at the desk, and a short day looks fully staffed. Fuzz `office_covered_by_carer` 81. Cases: `cases/office-staff-ill.json`, `cases/cover-rest.json`.

**R5. Carers on short-staffed shifts get no break.** A break needs another carer on the floor (`coveredWithout`), so a lone carer never gets one (Kasia: 7.5 hours). Working Time Regulations 1998, regulation 12: 20 minutes for over 6 hours. Fuzz `no_break` 258 (2 of 8 random-director baselines). Case: `cases/lone-late-carer.json`.

**R6. Tablets are given to residents who are asleep.** The 21:00 round reaches Raj (in bed from 20:00) and Peggy asleep, and in fuzz cases a late 13:00 round finds Win napping; `giveDose` doesn't check. Practice: wake them gently, offer later, or record "asleep" with the GP's agreement for that medicine. Every calm day. Case: `cases/calm-seed-1.json`.

**R7. The handover summary leaves out infection, isolation, outbreak, illness, end of life and hospital.** It lists falls, late or missed doses, requests, fluids and checks only (`trees.ts` `handoverSummary`). A real handover (SBAR) leads with who is isolated, ill, dying or away. This also matters for Phase 3, where minds read handovers. Code review.

**R8. A decline of under 3 days starts in the last days.** `finalFromT` is at once, so a resident walking to breakfast is bed-bound on comfort care a minute later, and a breakfast already queued is served (`meal_for_comfort_only` 20). The director draws 7 to 28 days, but scenarios and the admin panel allow 1. Case: `cases/short-decline-breakfast.json`.

**R9. A drink is given to a resident lying on the floor.** The first contact after a fall tops up an owed or stale drink, or the "fluids pushed" drink when ill, and the drinks round leaves one beside them, including after a serious fall while waiting for paramedics. Practice: nothing by mouth until assessed (a fracture may need surgery). Fuzz `drink_for_fallen` 341. Case: `cases/drink-on-floor.json`.

**R10. Flu isolation sometimes ends under 5 days after symptoms began.** Isolation ends 24 hours after symptoms end, and symptoms last 3 to 7 days, so about a quarter of flu cases come out at 4 to 5 days. UKHSA (ARI, 2024): a minimum of 5 days after onset. Fuzz `isolation_too_short` 69. Case: `cases/flu-isolation-short.json`.

**R11. Dennis, on comfort care, still has four oral medicine rounds.** Every resident is on every round (`createRound`). At the end of life, oral medicines are usually reviewed down and anticipatory medicines prescribed (NICE NG31); docs/12 lists the anticipatory medicines as left out. Every calm day.

**R12. Evenings happen in bedrooms.** The Lounge empties at 16:00; breakfast and supper are always in rooms; Raj and Dennis never leave their rooms. Most homes serve meals in the dining room and use the lounge in the evening (NICE QS50, mental wellbeing in care homes: meaningful activity and social contact). Calm days (the audit's "where" lines).

**R13. Day staffing is much richer than a typical home.** Two carers and an RN (plus the manager, activities and reception) for six residents, with carers 35 to 45% and the RN about 57% on idle activities; one carer at night. That's a design choice, but short staffing is the only thing that ever stretches the day team. Calm days (`sim --audit`).

**R14. Nobody receives a resident who moves in or comes back from hospital.** They appear in their chair or bed (`admit`, `returnFromHospital`): no welcome, no admission assessment, no review of the discharge letter or medicines. A severe illness also gets a GP consultation at any hour (03:34 in fuzz case 34) where a home would call NHS 111 or the out-of-hours service.

**R15. Card items the docs describe aren't modelled.** Arthur ("independent with prompting; helped only on his Monday shower day", docs/05) gets 15 minutes of morning care every day. Win's glucose check before breakfast (docs/05's daily routine table), Stan's night wandering and hallucinations, sundowning behaviour (it only moves falls), and shower days don't exist in the code. Code review against docs/05 and the cards.

**R16. Dennis is "end of life (weeks)" for about a year.** With the end-of-life weight of 10, his decline begins on average about a year into a run, so for months he is a man with weeks to live. Director tuning (`end_of_life_weight`).

**R17. One ambulance crew answers every call in turn.** Two or three serious falls at once queue for one crew, so the last waits for the others to be conveyed (with U17, Win's third fall in the cluster). Each 999 call would get its own response (whatever the delay). `falls.ts` `nextCall`. Case: `cases/three-falls-at-lunch.json`.

**R18. The floating night carer, shared with the main building, sometimes stays over 4 hours.** Mostly when Peggy needs two women after a hospital stay (U2) or with a fall. Fuzz `float_overstay` 14. Case: `cases/peggy-two-women-after-fall.json`.

**R19. Cover and staying on break the rest rules.** Carers are kept on the wing 14 hours (mostly U1), and a bank carer booked for a reception shift came back after 10.5 hours (`restedFor` checks planned shifts, not when someone actually left). Fuzz `excessive_hours` 28.

### Cosmetic Case: `cases/cover-rest.json`.

**C1. Visits to someone who has just died or left.** A visitor already walking to the room arrives and `visit.started` is logged for a resident who has died or been taken to hospital that minute; they then go home with no `visit.ended`, and nobody meets the family. Fuzz `care_for_absent_resident` 3. Case: `cases/visit-after-death.json`.

**C2. A resident in hospital is still "asking for help".** `leaveForHospital` clears `busyTaskId` but not `requestId` (reset on return). Fuzz `absent_resident_state` 25. Case: `cases/hospital-request.json`.

**C3. Nothing is recorded for doses missed while someone is in hospital** (on a MAR chart: "H"). Log only.

**C4. The engine's `two_person` invariant fires falsely for two-person walks.** It counts only staff standing still within 2.5 m, so a two-person escort to the toilet (Peggy after a serious fall) "has 0 staff" while everyone walks. A hard violation in the event log that isn't one. Fuzz 5. Case: `cases/peggy-two-women-after-fall.json`.

**C5. docs/11 lists `meds_trained` and `fall_moved_before_assessment` as engine invariants; `checkInvariants` has neither.** The golden test's check for `invariant.violated` with `meds_trained` can't fail, and its own check accepts any `agy_` id. Both rules are in the new monitor, with no violations in 3,000 cases.

**C6. Bev's session keeps residents who have left or died** in its list, logged at `activity.ended`. Log only.

**C7. A sick call for a shift more than a day ahead is dropped** ("no shift to miss", 529 of the fuzz inputs) because shifts are planned a day at a time. A call made on Monday for Wednesday is lost rather than held.

## 7. Decisions (project owner, 2026-10-01)

Recorded in full in [spec.md](spec.md) and [ADR-0007](../../adr/0007-care-policy-decisions-from-the-full-scenario-audit.md); the order of work is in [plan.md](plan.md).

1. **Visiting** follows UKHSA 2024: visits continue with precautions, isolating residents are visited in their room (up to 2 at a time, a setting in `data/director.json`), restrictions only on the health protection team's advice and time-limited, end-of-life visits always.
2. **End of life and hospital:** an advance care plan on each card (hospital transfer `yes`, `no` or `comfort_only`); a planned decline sets `comfort_only`, cancelling a pending ambulance unless it's for comfort; a death due in hospital happens there, with the family told.
3. **Same-sex care:** a turn with a pad change is female-only care; with no woman on shift, keep the last woman on (within rest limits), then a female agency worker, then a female carer from the main building, Lorna at night; after a serious fall, Peggy needs two staff with at least one woman, who does the personal care.
4. **A lone carer by day** can ask the main building for help; the night carer owns overdue evening turns from the handover, and handover notes list overdue tasks; a reservation with no available partner is released after a short time, with help requested.
5. **Card items:** diet texture (an IDDSI level per card), fluid limits and Win's glucose check now; Arthur's independence and Stan's night wandering later (noted in docs/05 as not yet modelled).
6. **The safety monitor becomes engine invariants** once each gap is fixed or accepted (safety rules as hard invariants, timing rules as service targets), with the director-off fixture re-recorded.
7. **One PR each, reviewed in turn.** Gaps marked * were placed by me (to confirm):

| PR | Gaps |
|---|---|
| A | The audit tooling and this report (no behaviour change) |
| B | U1, U5, U6*, U11, U13, U16, U17, R17* |
| C | U2, U3, U4, U7, R5*, R18*, R19* |
| D | U14, U15, U19*, R15 (Win's glucose check) |
| E | U8, U9, U10, U12*, U18*, R1, R2, R8*, R10*, C1* |
| F | R3, R4, R6, R7, R9, R11 to R16 (R15: Arthur, Stan), C2 to C7; then the monitor wired in |

## Sources

Checked on 2026-10-01; quoted where marked.

- UKHSA, [*Management of acute respiratory infection outbreaks in care homes*](https://www.gov.uk/government/publications/acute-respiratory-disease-managing-outbreaks-in-care-homes/management-of-acute-respiratory-infection-outbreaks-in-care-homes-guidance) (updated 2024): "Visiting should be facilitated unless there are exceptional circumstances"; for isolating residents "in-room visits are usually more appropriate"; "closure of the home to new admissions may be considered"; "proportionate reductions or postponement of non-essential communal activities"; symptomatic residents stay away from others "for a minimum of 5 days after onset"; staff who become unwell "should leave work as soon as it is safe to do so".
- UKHSA, [*Supporting safer visiting in care homes during infectious illness outbreaks*](https://www.gov.uk/guidance/supporting-safer-visiting-in-care-homes-during-infectious-illness-outbreaks) (15 April 2024): "There should not normally be any restrictions to visits into or out of a care home"; "even in exceptional circumstances, end of life visits should be facilitated".
- CQC, [Regulation 9A: visiting and accompanying in care homes, hospitals and hospices](https://www.cqc.org.uk/guidance-regulation/providers/regulations-service-providers-and-managers/health-social-care-act/regulation-9a) (in force 6 April 2024).
- Norovirus Working Party, [*Guidelines for the management of norovirus outbreaks in acute and community health and social care settings*](https://www.gov.uk/government/publications/norovirus-managing-outbreaks-in-acute-and-community-health-and-social-care-settings) (2012), and local care-home IPC guidance (for example [CH 30 Viral gastroenteritis](http://www.infectionpreventioncontrol.co.uk/wp-content/uploads/2019/06/CH-30-Viral-gastroenteritis-Norovirus-April-2023-Version-3.00-2.pdf)): closure to admissions during an outbreak; symptomatic staff off until 48 hours symptom-free.
- NICE [QS164 statement 4](https://www.nice.org.uk/guidance/qs164/chapter/quality-statement-4-levodopa-in-hospital-or-a-care-home) and NG71 (Parkinson's disease): levodopa within 30 minutes of the individually prescribed time in hospital or a care home.
- NICE [SC1, *Managing medicines in care homes*](https://www.nice.org.uk/guidance/sc1/chapter/Recommendations) (2014): record when and why a medicine was not given.
- NICE [CG179, *Pressure ulcers*](https://www.nice.org.uk/guidance/cg179/chapter/recommendations): change position at least every 6 hours if at risk, every 4 hours if at high risk.
- IDDSI level 6 (soft and bite-sized), for example [Cambridge University Hospitals](https://www.cuh.nhs.uk/patient-information/soft-and-bite-sized-food-iddsi-level-6/) and [Frimley Health](https://www.fhft.nhs.uk/patients-and-visitors/patient-information-library/iddsi-level-6-soft-and-bite-sized): avoid toast and dry biscuits.
- Long lie (an hour or more on the floor): [Physiopedia](https://www.physio-pedia.com/Long_Lie); NICE [NG249](https://www.nice.org.uk/guidance/ng249) (falls, 2024) treats a long lie as a marker of high risk.
- NICE NG31 (care of dying adults in the last days of life) and NG142 (end of life care for adults: service delivery): advance care planning and preferred place of death.
- NICE QS50 (mental wellbeing of older people in care homes): meaningful activity and social contact.
- Working Time Regulations 1998, regulation 12: a 20-minute rest break when working more than 6 hours.
- CQC fundamental standards: Regulation 9 (person-centred care), 10 (dignity and respect), 12 (safe care and treatment), 14 (nutrition and hydration), 17 (good governance, records), 18 (staffing).

Not a clinical review: these were read to check the model's behaviour against published practice, and a registered nurse or care manager should review any change to care rules (docs/05).

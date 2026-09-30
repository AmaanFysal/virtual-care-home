# 05 · Care operations

**Purpose:** the real-world care practice the sim encodes: rota and handovers, daily routine, care rules, and regulatory obligations.

> Status: decided for Phase 1 (2026-09-28). Source: [plan-v2](research/plan-v2.md) (How a real UK care home wing runs), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §1. Data: `data/rota.json`, `data/personas/*.json`.

Not a clinical tool: behaviour here is plausible, not authoritative. A registered nurse or care manager should review it before any real-world use.

## Shifts

| Shift | Hours | Who |
|---|---|---|
| `early` | 07:00–14:30 | Lead (senior carer or experienced CA) + CA |
| `late` | 14:00–21:30 | Lead (meds-trained: does the 21:00 round) + CA |
| `night` | 21:15–07:15 (next day) | One waking night CA. The RN is on call off the map; a floating night carer (female) visits from the main building |
| `rn_day` | 07:00–19:30 | The day RN (Maria Tue–Thu, an agency nurse otherwise) |
| `office` | 09:00–17:00 Mon–Fri | Joanne (manager); Bev (activities) Mon–Thu |
| `reception` | 08:30–16:30 Mon–Fri | Sanjay |

## Weekly rota (`data/rota.json`)

| Day | Early lead | Early CA | Late lead | Late CA | Night (starts that evening) | Day RN |
|---|---|---|---|---|---|---|
| Mon | Blessing | Tom | Kasia | Aisha | Florin | Agency RN |
| Tue | Blessing | Tom | Dave | Aisha | Florin | Maria |
| Wed | Blessing | Kasia | Dave | Aisha | Florin | Maria |
| Thu | Blessing | Tom | Kasia | Lucy (bank) | Aisha | Maria |
| Fri | Blessing | Tom | Dave | Shanice (bank) | Aisha | Agency RN |
| Sat | Kasia | Lucy (bank) | Dave | Shanice (bank) | Agency | Agency RN |
| Sun | Kasia | Lucy (bank) | Dave | Shanice (bank) | Florin | Agency RN |

Shift counts: Blessing 5, Dave 5, Kasia 5, Aisha 5 (3 lates, 2 nights), Tom 4, Florin 4 nights, Maria 3 long days; bank carers Lucy 3 and Shanice 3.

**Bank staff** (`employment: "bank"` in `staff.json`) are the home's own flexible pool: Lucy Brennan and Shanice Clarke know the residents but are not meds-trained. They cover the recurring gaps, so the only **agency** shifts in a normal week are the 4 RN days (Mon, Fri, Sat, Sun) and the Saturday night. Generated agency carers otherwise appear only when sickness or short staffing is injected (Phase 3).

Rules the rota keeps (checked by the validator and tests):
- **At most one lone agency night a week** (Saturday); no agency on early or late carer slots.
- **A female carer on every early and late shift**, for Peggy's female-only personal care. At night, when the night carer is male, the floating night carer covers it.
- **11 hours' rest** (Working Time Regulations): no late followed by an early next day, and no day shift the day after a night.
- Every late lead is meds-trained for the 21:00 round; shift leads are never agency.

**Agency staff** are generated when their shift is planned (`agy_` ids, grey circles). Agency carers are not meds-trained and don't know residents' preferences. The agency nurse is meds-trained and can assess falls. Their names come from a fixed list, picked with the `rota` RNG stream.

## Handovers

Handovers happen in the staff room during shift overlaps. **One carer always stays on the floor.**

| Time | Handing over | Receiving | Floor cover |
|---|---|---|---|
| 07:00–07:15 | Night carer | Early lead + day RN | Early CA covers, then gets a 5-minute briefing from the early lead |
| 14:00–14:30 | Early lead | Late lead + late CA | Early CA (outgoing) stays on the floor |
| 21:15–21:30 | Late lead | Night carer | Late CA (outgoing) stays on the floor |

The RN's evening handover to the on-call RN at 19:30 happens off the map (event `rn.on_call_started`).

**How handovers run (M4a):** the handover is created at 07:00, 14:00 and 21:15 with its members. Outgoing staff can still be assigned to it after their shift has ended, and don't leave while they owe it. It waits until the floor cover is out on the floor, gathers the members in the staff room (going ahead after 20 minutes if both sides are there, and after 30 with whoever is), runs for 15, 20 or 15 minutes, then logs `handover.completed`. After the 07:00 handover the early lead briefs the early CA for 5 minutes in the corridor. Staff whose shift ends stay on (`staying`) until their task is done and someone else covers the floor, so a late handover never leaves the wing empty.

**Phase 1 handover content** is a rules-generated summary in the `handover.completed` event. For each resident it lists falls, late or missed doses, help requests, whether fluids are below target, and night checks done. The LLM layer (Phase 2) will turn this into dialogue and allow information to be lost.

## Breaks

- **Day care staff:** one 30-minute break in the staff room, starting at a seeded time in a window: early 10:30–11:45, late 17:30–19:00, RN 11:30–12:15 (outside med rounds). Breaks are staggered between **carers**: nobody starts a break unless another carer (not the RN) is on the floor, and the break waits instead. It also waits while Peggy or Stan is in the Lounge and fewer than two other care staff would stay on the floor, and while female-only work is waiting and they're the only woman on. A break is paused (and resumed later) if they're called back: for a Lounge look-in about to go over its 15 minutes, or for work during a fall.
- **All breaks are in the staff room**, never the waiting area (visitors only) or anywhere else.
- **Night carer (alone, whoever is on that night: Florin, Aisha or agency):** one 25-minute break in the staff room, taken only while the floating night carer is on the wing. From 01:30 it waits for her next planned round (usually the one around 02:00 to 03:00) and starts **after** that round's two-person work (Dennis's turn, Raj's repositioning), so those still have two people. She stays on the wing until the break ends, covering checks, requests and Peggy's care; while she's there she counts as care staff on the floor, so the floor rule holds at every tick. He's called back from the break (it resumes afterwards) only for two-person work, anything within 10 minutes of its time limit, or a fall.
- **Office and reception:** 30-minute lunch around 12:30; this doesn't affect the floor rule.

## Daily routine

| Time | What |
|---|---|
| 06:30–10:00 | Waking: tea on waking for each resident (its own short visit), then morning personal care, staggered by wake time |
| 07:00 | Handover |
| 07:30–10:30 | Breakfast at the chair (or in bed, first, for anyone whose care is more than 30 minutes away) |
| 08:00 | Morning med round (RN; time-critical medication first); Win's blood glucose check before breakfast |
| 10:30 | Mid-morning drinks |
| 10:45–11:45 | Bev's music and reminiscence session in the Lounge (days she's on: Monday to Thursday) |
| 11:50 | Lunch-goers to the Lounge (Peggy and Stan walked by a carer; Win alone) |
| 12:15–13:30 | Lunch (main meal), protected mealtime: in the Lounge for those who choose it, otherwise at the chair |
| 13:00 | Lunchtime med round (RN) |
| 13:30–16:00 | Afternoon in the Lounge (TV, reading, puzzles, chatting); naps in an armchair; back to rooms by 14:45, or 16:00 after tea |
| 14:00 | Handover |
| 15:00 | Afternoon tea |
| 17:00 | Teatime med round (RN) |
| 17:30 | Supper at the chair |
| 19:30–22:30 | Bedtime care, staggered by each resident's bedtime |
| 20:00 | Late drink with a supper snack |
| 21:00 | Bedtime med round (late lead) |
| 21:15 | Handover |
| Night | Checks and repositioning at each resident's interval; night carer's break in the staff room during the floating carer's round after 01:30 |

## Resident care profiles (mechanical fields)

| Resident | Bed | Mobility and speed | Personal care | Wake / bed | Check interval day / night | Repositioning | Notes |
|---|---|---|---|---|---|---|---|
| Peggy | Room5.Bed | Zimmer frame, 0.4 m/s, high falls risk | 1 staff, female carers only | 07:30 / 21:00 | 60 / 60 min | — | Prompted toileting every 2 h; sundowns from 16:00 |
| Win | Room2.Bed | Walking stick, 0.5 m/s, medium falls risk | 1 staff | 07:00 / 21:30 | 120 / 120 min | — | Diabetes: glucose check before breakfast; heart failure: 1,500 ml fluid limit |
| Arthur | Room1.Bed | Rollator, 0.45 m/s, medium falls risk | Independent with prompting; 1 staff for shower | 06:30 / 22:30 | 120 / 240 min | — | Has capacity; chose 4-hourly night checks; few visitors |
| Raj | Room3.Bed | Non-ambulant, hoist | **2 staff** for all transfers and personal care | 06:30 / 20:00 | 120 / 120 min | 4-hourly at night | Aphasia; soft diet, needs help to eat |
| Stan | Room4.Bed | Walks unaided, shuffling, 0.6 m/s, high falls risk | 1 staff, prompting | 08:00 / 22:00 | 60 / 60 min | — | Lewy body: night wandering, hallucinations; sundowns from 16:30 |
| Dennis | Room6.Bed | Bed-bound | **2 staff** in bed | — (in bed) | 60 / 60 min | 2-hourly day and night | End of life: comfort feeding only (no hunger need, no meals; mouth care and sips at least every 120 min, usually at checks and turns); cannot ask for help |

**Lounge habits** (`care.lounge` on each card; Raj and Dennis stay in their room for now):

| Resident | Lunch in the Lounge | Stays for tea | Walked by a carer | Likes |
|---|---|---|---|---|
| Peggy | yes | yes | yes (zimmer, high falls risk) | chatting, TV |
| Win | yes | yes | no | chatting, reading |
| Arthur | no (prefers his room) | no | no | puzzles (the crossword), reading |
| Stan | yes | yes | yes (Lewy body, high falls risk) | TV (West Ham), chatting |

Arthur's Parkinson's medication is time-critical (`care.time_critical_meds`): he is first on every round.

Staff walk at 1.2 m/s; most visitors at 1.0 m/s, older visitors at 0.6 to 0.9 m/s (Bernard and Pat 0.6), children 1.1 m/s.

**Checks** (updated after M4b review):
- **By day** (07:00 to 21:30), a resident counts as checked whenever a carer sees them: an explicit check, any care with them, or a carer at work in the same room within 6 metres (observation, not logged).
- **At night** (21:30 to 07:00), and **always for Dennis** (bed-bound), a check only counts at the bedside: a carer within 1.5 metres. It is logged as `resident.checked` with `via: "check"` (a check visit) or `via: "care"` (a turn, pad change or other bedside care). Observation doesn't count.
- A check counts the moment the carer is at the bedside; mouth care and so on follow.
- Check tasks are created 30 minutes before a check is due; the interval in force is the one (day or night) that applied at the last check.
- **Rounds before handover:** at 06:40 the night carer, and at 20:55 the late shift, check anyone who would otherwise fall due during the next handover and the busy spell after it (until 08:00 and 22:15).

## The care schedule (M4b, `src/care.ts`)

| When | What |
|---|---|
| Wake time | **Tea on waking** (audit): its own visit by any carer, 2 minutes (5 for Raj, who needs help to drink), due within 15 minutes. Anyone still waiting for morning care 30 minutes after waking and before 07:30 gets **tea and toast**. The nurse also gives a drink with the 08:00 tablets to anyone awake who hasn't had their tea yet |
| Wake time (08:30 for Dennis) | Morning personal care (two-person care for Raj waits for the day shift at 07:00), then up to the chair: Raj by hoist with two staff into his wheelchair by the bed (he has no bedside chair), others walk to their bedside chair. Dennis stays in bed; his wash is timed to comfort, after the 08:00 round (user decision). Morning care rises in priority the longer they've been awake |
| 07:30–10:30 | **Breakfast from 07:30** (audit), at the chair once they're up; if their morning care is more than 30 minutes away (estimated from the care queued ahead of them and the carers free), breakfast comes first, in bed or at the chair, and care waits until they've eaten. 12:15 lunch (in the Lounge for lunch-goers); 17:30 supper. Raj is helped to eat (15 min), Peggy prompted (5); intake is charted for Peggy and Win, and Dennis's sips |
| Every 2 hours at least | Dennis's comfort care: mouth care and sips (usually done at his hourly checks and 2-hourly turns; a `comfort` task if the interval would lapse) |
| 10:30, 15:00, 20:00 | Drinks round: one carer takes tea and a biscuit (a supper snack at 20:00) to each resident in turn (2 min each). Anyone asleep or busy has it left by the bed or chair, except those who need help to drink (Raj, Dennis): theirs is owed and given at the next contact while awake. A left drink goes stale after 2 hours and is replaced at the next contact (`drink.served` with `outcome` and round `top_up`) |
| Every 2 hours awake | Peggy's prompted toileting: walked to the WC and back by a female carer |
| Every 2 hours, day and night | Dennis turned by two staff, with a pad change, fluids and mouth care (see "Turning" below) |
| Bed time | Bedtime care with a warm drink, then into bed (Raj by hoist) |
| 06:40, 20:55 | Checks before handover for anyone due before 08:00 / 22:15 |
| Night rounds | See "Floating night carer" |

**Turning** (service target `reposition`, after the M6 review):
- A turn counts from when it starts; personal care in bed also turns Dennis; being put to bed starts Raj's night clock.
- **By day** turns are scheduled from when each is due (created 30 minutes before, with deadline pressure; reserved 25 minutes before so nobody starts a long job just before one). A turn that would fall due in the evening crunch (20:00 to 21:30: Raj's bedtime, the drinks round, the 21:00 med round, the 21:15 handover) is brought forward to 19:45. If Dennis's morning care is still waiting when a turn falls due, the care takes the turn on.
- **From 21:30 to 08:00** the floating carer's rounds cover turns: she comes **about 10 minutes before** the latest time that still lets the turns falling due together each start on time one after another (so rounds follow Dennis's turns, roughly every 2 hours), and batches anyone else due within 70 minutes (Raj's 4-hourly turn). Turns due during the 07:00 handover (06:45 to 07:30) are planned for 06:45. While she waits she does a round of checks. She stays until the round's turns are done. Turns don't interrupt a medication round.
- A carer won't start a day break if a two-person turn is due within 45 minutes and fewer than two others would be free; the floor cover for a handover keeps working past their shift end until the handover is done.
- Result: with Dennis's wash at 08:30, 3 turning breaches in 56 no-fall days (his turn due about 08:21, in the morning rush), reported (docs/12). Occasional breaches on normal days are accepted (user decision).

**Wait-time rule** (spec decision 18): every request gets a deadline when it is made: 30 minutes by day; at night, if nobody on site can do it (two-person, or female-only with a male night carer), the next round + 20 minutes when the round is within 30 minutes, otherwise a call-out and 30 minutes. Scheduled care already under way with the resident takes over a waiting request. Overdue requests are an invariant violation (`request_wait`).

## Procedures (behaviour trees)

Full node-level trees are in [04](04-agents-and-behaviour.md). The care content they must follow:

1. **Morning personal care.** Roughly in wake-time order, a carer goes to the bedside, helps with washing and dressing (20 minutes; 25 for Raj with two staff and the hoist; 30 for Dennis in bed with two staff), then helps the resident to their chair (Raj via the hoist). Peggy gets female carers only. Arthur is prompted and only helped on his shower day (Monday).
2. **Medication round** (M5, `src/meds.ts`). The meds-trained giver (the day RN at 08:00, 13:00 and 17:00; the late lead at 21:00) gives time-critical medication first (Arthur's Parkinson's), then goes bed to bed, 3 minutes per resident; anyone busy is visited at the end, wherever they are (the Lounge included). From 07:45 until the 08:00 round is done the day RN doesn't start any resident care, so the round starts on time (on seeds 1 to 8: on time on 48 of 56 mornings, never more than 8 minutes late). A fall, or a help request within 10 minutes of its limit that nobody else can take, pauses the round; it resumes where it stopped (`task.interrupted`, `task.resumed`). Each interruption adds 5 percentage points to the chance each remaining dose is **missed** (capped at 40%); a dose given more than 60 minutes after the round time is **late**. Both are logged (`med.missed`, `med.late`) and counted in the handover summary. The 21:15 handover waits for the 21:00 round to finish. Night PRN requests (`med.prn_requested`) are defined but not generated in Phase 1: nothing yet causes pain.
3. **Meal service.** At meal times a carer takes a tray (badge) to each resident where they are: their chair, bed (breakfast first), or the Lounge dining table. Raj needs a carer with him for about 15 minutes to eat. Peggy needs prompting. Dennis has no meals (comfort care). Intake is recorded for Peggy and Win, and Dennis's sips.
4. **Fall response** (M5, `src/falls.ts`; falls come only from `inject_fall`).
   - **Day (an RN on the wing):** the nearest carer whose work can wait (not in a handover, if possible) comes, finds the resident and stays; the RN is pulled in (pausing a med round) and assesses (10 minutes). Nobody moves the resident before assessment. For a minor fall the nearest other carer joins and two staff lift with the hoist, back to bed or chair.
   - **Night, or evening once the RN is on call:** the carer finds them and phones the on-call RN; the call is the assessment (3 to 5 minutes, seeded). If cleared, the floating night carer is called out (or joins if on site) and the two lift. If "wait for ambulance", the carer keeps the resident comfortable on the floor and stays with them; the floating carer is called out to cover the rest of the wing, and **the on-call RN comes over from the main building** (8 to 12 minutes, `on_call_rn.called` / `.arrived` / `.departed`, a purple "RN" circle) and works on the wing until the paramedics have gone. Paramedics arrive after a seeded 30 to 90 minutes. Minor night falls stay phone-only.
   - **Afterwards:** severity `minor` means back to bed or chair and post-fall checks every 30 minutes for 4 hours (priority above routine care). Severity `serious` means 999, the paramedics (a purple "PM" circle) arrive, spend 10 minutes with the resident, and take them to hospital: the resident leaves the map and their bed shows "in hospital"; `cqc.notification_flagged` (Registration Regulations 2009, Regulation 18, serious injury). The family (next of kin) is phoned after every fall (`family.informed`) and an incident recorded. Return from hospital is Phase 3.
   - **Several falls at once (who comes, and what it may interrupt).** Nobody is ever left on the floor.
     - **What a fall may interrupt.** A fall takes the nearest carer whose work can wait: a meal, a drink, an idle activity, a wash at the bedside (the carer makes the resident safe; the wash goes back on the queue), a break, or a medication round (paused and resumed later). It never takes anyone attending another fall, anyone in the middle of a two-person transfer, hoist or turn, or anyone walking a resident who is on their feet (`criticalWork`).
     - **When nobody can come.** Help is asked for (`fall.help_requested`, with what everyone is doing). At night the floating carer is called out; if she is already here or on her way, the on-call RN comes over (and if help that was on its way goes to another fall, the next is called). The fall then goes to the next person free, ahead of any other work, checked every tick (`staffFalls`).
     - **The RN.** A carer who has reached a fall waits with the resident for the RN if she is with another resident.
     - **Lifting.** Helpers for a lift come only once every fall has someone with them. If everyone on the wing is with a fallen resident, each assessed and waiting for a lift, and no more help is coming, two of them lift one resident at a time (the earliest fall first). The resident they leave, assessed and made comfortable, has help asked for.
     - **The fallen resident.** Nothing about them changes until they have been assessed and moved: they don't fall asleep, ask for help, drink or leave on their own. Their own trip to the WC or the Lounge is cancelled.
     - **Ambulances.** One paramedic crew answers the calls in turn, the one due soonest first.
     - **Afterwards.** A carer's day break cut short by a fall resumes only once someone else covers the floor.
     - **Medication.** A medication round whose giver is with a fallen resident (or has left the wing) goes to another meds-trained member of staff who is free, for example the on-call RN over for a serious fall at 21:00; a giver who had to leave a round doesn't go home until it's done.
     - **Targets and rules.** Time from a fall to someone reaching them is a service target (5 minutes, `fall_attendance`, with the cause, e.g. "lone night carer with another fall"). A fallen resident with nobody attending or on the way and no help asked for, for more than 2 minutes, breaks a hard rule (`fall_unattended`).

# 05 · Care operations

**Purpose:** the real-world care practice the sim encodes: rota and handovers, daily routine, care rules, and regulatory obligations.

> Status: decided for Phase 1 (2026-09-28). Source: [plan-v2](research/plan-v2.md) (How a real UK care home wing runs), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §1. Data: `data/rota.json`, `data/personas/*.json`.

Not a clinical tool: behaviour here is plausible, not authoritative. A registered nurse or care manager should review it before any real-world use.

## Shifts

| Shift | Hours | Who |
|---|---|---|
| `early` | 07:00–14:30 | Lead (senior carer or experienced CA) + CA |
| `late` | 14:00–21:30 | Lead (meds-trained: does the 21:00 round) + CA |
| `night` | 21:15–07:15 (next day) | One waking night CA. The RN and a second carer are on call off the map |
| `rn_day` | 07:00–19:30 | The day RN (Maria Tue–Thu, an agency nurse otherwise) |
| `office` | 09:00–17:00 Mon–Fri | Joanne (manager); Bev (activities) Mon–Thu |
| `reception` | 08:30–16:30 Mon–Fri | Sanjay |

## Weekly rota (`data/rota.json`)

| Day | Early lead | Early CA | Late lead | Late CA | Night (starts that evening) | Day RN |
|---|---|---|---|---|---|---|
| Mon | Blessing | Tom | Kasia | Aisha | Florin | Agency RN |
| Tue | Blessing | Tom | Dave | Aisha | Florin | Maria |
| Wed | Blessing | Kasia | Dave | Aisha | Florin | Maria |
| Thu | Blessing | Tom | Kasia | Aisha | Agency | Maria |
| Fri | Blessing | Tom | Dave | Aisha | Agency | Agency RN |
| Sat | Kasia | Agency | Dave | Agency | Agency | Agency RN |
| Sun | Kasia | Agency | Dave | Agency | Florin | Agency RN |

Shift counts: Blessing 5, Dave 5, Kasia 5, Aisha 5, Tom 4, Florin 4 nights, Maria 3 long days. The seven empty care slots and four RN days go to generated agency staff. Weekends are thin, which is realistic. No one works a late followed by an early the next day (the Working Time Regulations require 11 hours' rest), and every late lead is meds-trained for the 21:00 round.

**Agency staff** are generated when their shift starts (`agy_` ids, grey circles). Agency carers are not meds-trained and don't know residents' preferences. The agency nurse is meds-trained and can assess falls. Their names come from a fixed list, picked with the `rota` RNG stream.

## Handovers

Handovers happen in the staff room during shift overlaps. **One carer always stays on the floor.**

| Time | Handing over | Receiving | Floor cover |
|---|---|---|---|
| 07:00–07:15 | Night carer | Early lead + day RN | Early CA covers, then gets a 5-minute briefing from the early lead |
| 14:00–14:30 | Early lead | Late lead + late CA | Early CA (outgoing) stays on the floor |
| 21:15–21:30 | Late lead | Night carer | Late CA (outgoing) stays on the floor |

The RN's evening handover to the on-call RN at 19:30 happens off the map (event `rn.on_call_started`).

**Phase 1 handover content** is a rules-generated summary in the `handover.completed` event. For each resident it lists falls, late or missed doses, help requests, whether fluids are below target, and night checks done. The LLM layer (Phase 2) will turn this into dialogue and allow information to be lost.

## Breaks

- **Day care staff:** one 30-minute break, in the staff room. Early: 10:30–12:00. Late: 17:30–19:30. The RN's 30 minutes falls at 12:00–14:00, outside med rounds. Breaks are staggered: nobody starts a break if that would leave the floor uncovered, and the break is postponed instead.
- **Night carer (alone):** one 30-minute break around 03:00, taken in the waiting area, not the staff room. They stay interruptible and count as on the floor.
- **Office and reception:** 30-minute lunch around 12:30; this doesn't affect the floor rule.

## Daily routine

| Time | What |
|---|---|
| 06:30–10:00 | Waking and morning personal care, staggered by each resident's wake time |
| 07:00 | Handover |
| 08:00 | Morning med round (RN); Win's blood glucose check before breakfast |
| 08:00–09:30 | Breakfast at the bedside, served as each resident is up |
| 10:30 | Mid-morning drinks |
| 12:15–13:30 | Lunch (main meal), protected mealtime |
| 13:00 | Lunchtime med round (RN) |
| 14:00 | Handover |
| 15:00 | Afternoon tea |
| 17:00 | Teatime med round (RN) |
| 17:30 | Supper |
| 19:30–22:30 | Bedtime care, staggered by each resident's bedtime |
| 20:00 | Late drink |
| 21:00 | Bedtime med round (late lead) |
| 21:15 | Handover |
| Night | Checks and repositioning at each resident's interval; night carer's break around 03:00 |

## Resident care profiles (mechanical fields)

| Resident | Bed | Mobility and speed | Personal care | Wake / bed | Check interval day / night | Repositioning | Notes |
|---|---|---|---|---|---|---|---|
| Peggy | Room1.BedA | Zimmer frame, 0.4 m/s, high falls risk | 1 staff, female carers only | 07:30 / 21:00 | 60 / 60 min | — | Prompted toileting every 2 h; sundowns from 16:00 |
| Win | Room1.BedB | Walking stick, 0.5 m/s, medium falls risk | 1 staff | 07:00 / 21:30 | 120 / 120 min | — | Diabetes: glucose check before breakfast; heart failure: 1,500 ml fluid limit |
| Arthur | Room2.BedA | Rollator, 0.45 m/s, medium falls risk | Independent with prompting; 1 staff for shower | 06:30 / 22:30 | 120 / 240 min | — | Has capacity; chose 4-hourly night checks; few visitors |
| Raj | Room2.BedB | Non-ambulant, hoist | **2 staff** for all transfers and personal care | 06:30 / 20:00 | 120 / 120 min | 4-hourly at night | Aphasia; soft diet, needs help to eat |
| Stan | Room2.BedC | Walks unaided, shuffling, 0.6 m/s, high falls risk | 1 staff, prompting | 08:00 / 22:00 | 60 / 60 min | — | Lewy body: night wandering, hallucinations; sundowns from 16:30 |
| Dennis | Room2.BedD | Bed-bound | **2 staff** in bed | — (in bed) | 60 / 60 min | 2-hourly day and night | End of life; mouth care with checks; cannot ask for help |

Staff walk at 1.2 m/s; visitors at 1.0 m/s (Bernard and Pat, both in their 80s or older, at 0.6 m/s).

A resident counts as **checked** when a care staff member does a care task with them or an explicit check (event `resident.checked`).

## Procedures (behaviour trees)

Full node-level trees are in [04](04-agents-and-behaviour.md). The care content they must follow:

1. **Morning personal care.** In wake-time order, a carer goes to the bedside, helps with washing and dressing (20 minutes; 25 for Raj with two staff and the hoist; 30 for Dennis in bed with two staff), then helps the resident to their chair (Raj via the hoist). Peggy gets female carers only. Arthur is prompted and only helped on his shower day (Monday).
2. **Medication round.** The meds-trained giver goes bed to bed in a fixed order, about 3 minutes per resident. The round can be interrupted (help request, fall): it pauses, the giver deals with the interruption, then resumes at the next resident not yet given. Each interruption adds 5 percentage points to the chance that each remaining dose is late (> 60 minutes after the round time) or missed, capped at 40%. Late and missed doses are logged.
3. **Meal service.** At meal times a carer takes a tray (badge) to each resident at their chair, or in bed for Dennis. Raj needs a carer with him for about 15 minutes to eat. Peggy needs prompting. Dennis gets mouth care and sips only. Intake is recorded for Peggy, Win and Dennis.
4. **Fall response.**
   - **Day:** the first staff member to arrive stays with the resident and calls the RN (on the map). The RN assesses (10 minutes). Nobody moves the resident before assessment. Then two staff lift with the hoist and return the resident to bed or chair.
   - **Night:** the night carer does a first check and calls the on-call RN; the phone call is the assessment (3 to 5 minutes). If cleared, the off-map second carer arrives within about 10 minutes and the two lift. If "wait for ambulance", the carer keeps the resident comfortable on the floor and stays with them; paramedics arrive after a seeded 30 to 90 minutes.
   - **Afterwards (any time):** severity `minor` means back to bed or chair and post-fall checks every 30 minutes for 4 hours. Severity `serious` means 999, paramedics, conveyance to hospital and `cqc.notification_flagged` (Regulation 18, serious injury). The family (the resident's next of kin) is phoned after every fall (`family.informed`). An incident is always recorded.
5. **Night checks.** The night carer visits each resident when their interval is due, with a short check (1 minute) or repositioning. **Two-person tasks at night** (Dennis's 2-hourly and Raj's 4-hourly repositioning) use the off-map second carer, who is called in and does both residents in one visit where the timings allow.

## Care rules (hard constraints)

- Raj: two staff for every transfer and for personal care. Dennis: two staff for repositioning and personal care.
- A fallen resident is not moved before assessment.
- Only meds-trained staff administer medication (the RN, senior carers Blessing and Dave, Kasia, and the agency nurse).
- Peggy has female carers only for personal care.
- Visitors never enter the staff room.

## Visiting (Regulation 9A, open visiting)

- Visitors can arrive at any time. Between 08:30 and 16:30 on weekdays Sanjay signs them in at the desk. Otherwise they ring the bell and a care staff member comes to the exit door, lets them in and signs them in (an interruption).
- **Soft friction:** during protected lunch (12:15–13:30) and while personal care is under way in the resident's room, visitors wait in the waiting area. Kuldip is allowed to help Raj at lunch.
- Visitors go to the resident's bedside chair, or the waiting area if the resident is there, and stay for their visit duration, then sign out and leave.

## Notifications and safeguarding

Phase 1 only flags them: `cqc.notification_flagged` on a serious-injury fall or a conveyance to hospital. The manager's "notify CQC" task, Regulation 16 (death), safeguarding (Section 42) and DoLS come with the director in Phase 3.

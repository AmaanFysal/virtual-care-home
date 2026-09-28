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

- **Day care staff:** one 30-minute break in the staff room, starting at a seeded time in a window: early 10:30–11:45, late 17:30–19:00, RN 11:30–12:15 (outside med rounds). Breaks are staggered between **carers**: nobody starts a break unless another carer (not the RN) is on the floor, and the break waits instead.
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
| Wake time (07:30 for Dennis) | Morning personal care (two-person care for Raj and Dennis waits for the day shift at 07:00) (with a cup of tea and a biscuit), then up to the chair: Raj by hoist with two staff, others walk; Dennis stays in bed |
| 08:00–10:30 | Breakfast at the chair once they are up; 12:15 lunch; 17:30 supper. Raj is helped to eat (15 min), Peggy prompted (5), Dennis gets mouth care and sips; intake is charted for Peggy, Win and Dennis |
| 10:30, 15:00, 20:00 | Drinks round: one carer takes tea and a biscuit to each resident in turn (2 min each); left by the bed or chair for anyone asleep or busy |
| Every 2 hours awake | Peggy's prompted toileting: walked to the WC and back by a female carer |
| Every 2 hours, day | Dennis turned by two staff, with a pad change, fluids and mouth care |
| Bed time | Bedtime care with a warm drink, then into bed (Raj by hoist) |
| 06:40, 20:55 | Checks before handover for anyone due before 08:00 / 22:15 |
| Night rounds | See "Floating night carer" |

**Wait-time rule** (spec decision 18): every request gets a deadline when it is made: 30 minutes by day; at night, if nobody on site can do it (two-person, or female-only with a male night carer), the next round + 20 minutes when the round is within 30 minutes, otherwise a call-out and 30 minutes. Scheduled care already under way with the resident takes over a waiting request. Overdue requests are an invariant violation (`request_wait`).

## Procedures (behaviour trees)

Full node-level trees are in [04](04-agents-and-behaviour.md). The care content they must follow:

1. **Morning personal care.** In wake-time order, a carer goes to the bedside, helps with washing and dressing (20 minutes; 25 for Raj with two staff and the hoist; 30 for Dennis in bed with two staff), then helps the resident to their chair (Raj via the hoist). Peggy gets female carers only. Arthur is prompted and only helped on his shower day (Monday).
2. **Medication round** (M5, `src/meds.ts`). The meds-trained giver (the day RN at 08:00, 13:00 and 17:00; the late lead at 21:00) goes bed to bed in a fixed order, 3 minutes per resident; anyone busy is visited at the end. A fall, or a help request within 10 minutes of its limit that nobody else can take, pauses the round; it resumes where it stopped (`task.interrupted`, `task.resumed`). Each interruption adds 5 percentage points to the chance each remaining dose is **missed** (capped at 40%); a dose given more than 60 minutes after the round time is **late**. Both are logged (`med.missed`, `med.late`) and counted in the handover summary. The 21:15 handover waits for the 21:00 round to finish. Night PRN requests (`med.prn_requested`) are defined but not generated in Phase 1: nothing yet causes pain.
3. **Meal service.** At meal times a carer takes a tray (badge) to each resident at their chair, or in bed for Dennis. Raj needs a carer with him for about 15 minutes to eat. Peggy needs prompting. Dennis gets mouth care and sips only. Intake is recorded for Peggy, Win and Dennis.
4. **Fall response** (M5, `src/falls.ts`; falls come only from `inject_fall`).
   - **Day (an RN on the wing):** the nearest carer (not in a handover) is pulled off whatever they were doing, finds the resident and stays; the RN is pulled in (pausing a med round) and assesses (10 minutes). Nobody moves the resident before assessment. For a minor fall the nearest other carer joins and two staff lift with the hoist, back to bed or chair.
   - **Night, or evening once the RN is on call:** the carer finds them and phones the on-call RN; the call is the assessment (3 to 5 minutes, seeded). If cleared, the floating night carer is called out (or joins if on site) and the two lift. If "wait for ambulance", the carer keeps the resident comfortable on the floor and stays with them; the floating carer is called out to cover the rest of the wing, and **the on-call RN comes over from the main building** (8 to 12 minutes, `on_call_rn.called` / `.arrived` / `.departed`, a purple "RN" circle) and works on the wing until the paramedics have gone. Paramedics arrive after a seeded 30 to 90 minutes. Minor night falls stay phone-only.
   - **Afterwards:** severity `minor` means back to bed or chair and post-fall checks every 30 minutes for 4 hours (priority above routine care). Severity `serious` means 999, the paramedics (a purple "PM" circle) arrive, spend 10 minutes with the resident, and take them to hospital: the resident leaves the map and their bed shows "in hospital"; `cqc.notification_flagged` (Registration Regulations 2009, Regulation 18, serious injury). The family (next of kin) is phoned after every fall (`family.informed`) and an incident recorded. Return from hospital is Phase 3.
5. **Night checks.** The night carer visits each resident when their interval is due, with a short check (1 minute) or repositioning. The night carer does all of Peggy's checks.

### Floating night carer

Lorna Mitchell (`ext_night_float`, female) covers the night from the main building and is off the map except when visiting.

- **Planned rounds** at 22:00, 00:00, 02:00, 04:00 and 06:00, aligned with Dennis's 2-hourly turns. Each round batches whatever is due: Dennis's turn (always), Raj's 4-hourly repositioning (22:00, 02:00, 06:00), and Peggy's personal care (pad change) if it is due, since Peggy has female carers only.
- **Out-of-round call-outs** only for urgent two-person tasks (a hoist lift after a fall) or urgent same-sex tasks (Peggy's personal care that can't wait for the next round). She arrives within about 10 minutes.
- Her arrivals and departures are logged (`second_carer.arrived` with `planned`, `second_carer.departed`); every call-out is logged (`second_carer.called` with `outOfRound`) and counted (`world.metrics.floatCallouts`).
- While on site she works like any carer, and stays until nothing needs her and nothing is due within 20 minutes (this covers the busy 22:00 round, with bedtimes and checks).
- On seeds 1 to 8 over a week, the planned rounds cover all night work: 35 visits a week and no call-outs. A call-out is tested directly (a forced 23:00 request from Raj).
- **Time on site:** about 2 hours a night (17 to 28% of the 570-minute night) across seeds 1 to 8; no night over 50%. `--report` prints it per night and flags any night over 50%.

## Care rules (hard constraints)

- Raj: two staff for every transfer and for personal care. Dennis: two staff for repositioning and personal care.
- A fallen resident is not moved before assessment (invariant `fall_moved_before_assessment`).
- Only meds-trained staff administer medication (the RN, senior carers Blessing and Dave, Kasia, and the agency nurse; invariant `meds_trained`).
- Peggy has female carers only for personal care. At night, when the night carer is male, the floating night carer does it (on a planned round, or an out-of-round call-out if urgent).
- Visitors never enter the staff room.

## Visiting (Regulation 9A, open visiting)

- Visitors can arrive at any time. Between 08:30 and 16:30 on weekdays Sanjay signs them in at the desk. Otherwise they ring the bell and a care staff member comes to the exit door, lets them in and signs them in (an interruption).
- **Soft friction:** during protected lunch (12:15–13:30) and while personal care is under way in the resident's room, visitors wait in the waiting area. Kuldip is allowed to help Raj at lunch.
- Visitors go to the resident's bedside chair, or the waiting area if the resident is there, and stay for their visit duration, then sign out and leave.

## Notifications and safeguarding

Phase 1 only flags them: `cqc.notification_flagged` on a serious-injury fall or a conveyance to hospital. The manager's "notify CQC" task, Regulation 16 (death), safeguarding (Section 42) and DoLS come with the director in Phase 3.

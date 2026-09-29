# 12 · Risks and debt

**Purpose:** a living register of known risks, caveats and deliberate technical debt, with owners and mitigations.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Caveats), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) (Caveats).

## Known risks (from research, to be triaged)

- Base rates are approximate and context-dependent; treat them as tunable parameters.
- Some workforce figures are secondary sources.
- Model names and prices change often; cost per sim day is an estimate to measure in Phase 2.
- Shared rooms are less common in modern UK homes; say so in demos.
- The 10-person rota cannot cover 24/7 alone; relies on off-map support and agency / bank staff.
- LLM bias and dignity; human review of every persona.
- Not a clinical tool; care processes need RN / care manager review before any real-world use.

## To be decided

- Register format (table with likelihood, impact, mitigation, owner?).
- How deliberate debt is logged and when it must be paid down.

## Findings from the simulation (Phase 1)

- **Night emergencies need three pairs of hands.** Resolved (user decision after M5): for a serious fall with no RN on the wing, the on-call RN comes over from the main building until the paramedics have gone.
- **A serious fall in the morning rush** can delay an hourly bedside check by a few minutes (Dennis): 1 service breach in 65 fall runs. Reported as `sla.breached` with its cause; service targets may slip during falls by design.
- **Tuned parameters.** Need rates, priorities and deadline pressure were tuned against these runs (docs/04). They are not measured values.
- **Not generated yet:** PRN (as-needed) medication requests; return from hospital (Phase 3).


## Tuning debt: scheduling rules added to reach zero service breaches (2026-09-29)

In the Lounge and audit-fixes round (M8) these narrow rules were added, beyond what the user asked for, to keep service breaches at zero on every no-fall week. Each one patches a specific clash in the rota rather than modelling something general. The user's decision: occasional breaches on normal days are acceptable and realistic, so no more rules like these. Revisit them all when the scenario director arrives (Phase 3), and remove any that the director or better staffing models make unnecessary. Everything is in `packages/sim-engine/src` unless stated.

| Rule | Where | Clash it patched |
|---|---|---|
| Breakfast gets the same time-awake boost (+1.5/min, max 90) as morning care | `tasks.ts` `taskScore` | Late risers' washes beat early risers' breakfasts |
| Breakfast offered first holds that resident's morning care until they've eaten; "care more than 30 minutes away" estimated from the care queued ahead and the carers available | `tasks.ts` `breakfastFirst`, `morningCareWaitMins` | Breakfast-first fired for Raj at 07:30 and delayed his two-person care |
| Female-only care +25 for women; the only woman on shift −30 for two-person work while female-only care is pending | `tasks.ts` `taskScore`, `femaleOnlyPending` | Peggy's female-only care and toilet waiting while Blessing did two-person work |
| A break waits while female-only work is waiting and they're the only woman on | `tasks.ts` `onlyOneFor` | Shanice's break left Peggy's request with nobody who could do it |
| Briefing starts only when both are free; the first free keeps to short work for up to 10 minutes | `tasks.ts` step 1 | The 5-minute hold, drop and re-hold loop wasted the morning |
| A reserved task waits for its reserver on a short task unless pressing; two others go only if pressing | `tasks.ts` step 3 | The pair went without the reserver and took the only woman |
| Turns are "pressing" 25 minutes ahead (day turns created 30 minutes ahead); a pressing turn's only possible partner keeps to short work | `tasks.ts` `PRESSING_TURN_MINS`, `solePartner`; `care.ts` `TURN_LEAD_MINS` | Carers started 20-minute washes or pad changes just before a turn fell due |
| A turn can be reserved while its resident is briefly busy with a short task | `tasks.ts` step 3 | A one-minute check blocked Dennis's turn reservation |
| Someone on an interruptible break can reserve a pressing turn | `tasks.ts` reservation check | The night carer on break took a pad change instead |
| Pressing reservations are made before any other matching; the most pressing first | `tasks.ts` `bestReserve` | Reservations went to the lowest task id |
| Dennis's morning care takes on a turn that falls due | `care.ts` turn merge | Two separate two-person visits in the morning rush |
| Peggy's toilet prompt is skipped while her morning care is still to come | `care.ts` | A redundant visit in the crunch |
| Evening crunch extended to 21:30 (turns due 20:00 to 21:30 moved to 19:45); the floating carer covers turns from 21:30 | `care.ts` `FLOAT_TURNS`, `EVENING_CRUNCH` | The 21:15 turn clashed with the 21:00 round and the handover |
| Floating carer: plans back-to-back turns so each starts by its due time; turns due in the 07:00 handover (06:45 to 07:30) are planned for 06:45 | `float.ts` `plannedBy`, `startBy` | 10 minutes' notice wasn't enough for two turns due together, or around the handover |
| Turns don't interrupt a medication round | `tasks.ts` `targetTask` | The 21:00 round was interrupted nightly, causing missed doses |
| Anyone on a day break can be called back for work during a fall | `tasks.ts` pool | Two-person work stacked up during falls |
| Lounge: a two-person job that would leave nobody able to look in waits up to 10 minutes (not during a fall); breaks staggered so two stay on the floor; an urgent look-in calls someone back from a break | `tasks.ts` | Nurse on break plus Raj's two-person pad change left Peggy and Stan unsupervised |
| Tea has a hard deadline; the nurse gives a drink with the 08:00 tablets to anyone who hasn't had tea | `tasks.ts`, `meds.ts` | Stan's tea at 08:00 while both carers did Dennis's wash (largely moot since Dennis's wash moved to 08:30) |

**Remaining clashes, reported rather than patched** (seeds 1 to 8, no falls, after Dennis's wash moved to 08:30):
- 4 service breaches in 56 days: Dennis's turn due about 08:21 (3), and Peggy's toilet request at 13:03 (1).
- The 08:00 round started 17 to 20 minutes late on 16 mornings: the nurse started a one-person wash (Peggy's) just before 08:00. The 07:45 rule covers only two-person care.
- The week tests allow up to 2 reported breaches per no-fall week (user decision).

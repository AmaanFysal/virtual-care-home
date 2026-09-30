# 12 · Risks and debt

**Purpose:** a living register of known risks, caveats and deliberate technical debt, with owners and mitigations.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Caveats), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) (Caveats).

## Known risks (from research, to be triaged)

- Base rates are approximate and context-dependent; treat them as tunable parameters.
- Some workforce figures are secondary sources.
- Model names and prices change often; cost per sim day is an estimate to measure in Phase 3 (LLM minds).
- The 10-person rota cannot cover 24/7 alone; relies on off-map support and agency / bank staff.
- LLM bias and dignity; human review of every persona.
- Not a clinical tool; care processes need RN / care manager review before any real-world use.

## To be decided

- Register format (table with likelihood, impact, mitigation, owner?).
- How deliberate debt is logged and when it must be paid down.

## Findings from the simulation (Phase 1)

- **Night emergencies need three pairs of hands.** Resolved (user decision after M5): for a serious fall with no RN on the wing, the on-call RN comes over from the main building until the paramedics have gone.
- **A serious fall in the morning rush** can delay an hourly bedside check by a few minutes (Dennis): 1 service breach in 65 fall runs. Reported as `sla.breached` with its cause; service targets may slip during falls by design.
- **Several falls at once used to abandon residents.** Fixed (2026-09-30): a fall never takes anyone from another fall, a two-person transfer or a walking resident; a fall nobody can reach asks for help and goes to the next person free; a hard invariant (`fall_unattended`) now catches anyone left. One judgement call remains: when everyone on the wing is with a fallen resident waiting for a lift and no more help can come, two carers lift one resident at a time, so an assessed resident is briefly left (with help asked for). The alternative would be waiting indefinitely. The left resident must be assessed as not injured, made comfortable, and looked in on every 5 minutes; with two minor falls, two carers and nobody to spare from the main building, that can't be done during a 5-minute hoist lift, so the missed look-in is reported (`fall_waiting_check`).
- **Visitors' waiting-area seats depend on how many people exist.** `visitors.ts` picks a seat by the visitor's position in `world.order`, so adding anyone to the world (an agency worker, the main-building carer) moves some visitors to other seats. Harmless, but it's why the main-building carer is added only when first asked for, to keep runs without falls byte-identical. Fix it (a seat chosen by the visitor's own id) the next time the golden fixtures are re-recorded.
- **Tuned parameters.** Need rates, priorities and deadline pressure were tuned against these runs (docs/04). They are not measured values.
- **Not generated yet:** PRN (as-needed) medication requests; care-profile changes after a hospital stay (Phase 2, director sub-milestone (c)).

## Findings from the scenario director (Phase 2)

- **Hospital return is simple.** A resident comes back 3 to 10 days after conveyance to their own bed with the same care profile; reduced mobility, new falls risk or extra care after a stay come in (c).
- **A round nobody on the wing can give waits for the on-call RN** (25 to 35 minutes; only when a scenario leaves a lead's slot uncovered).
- **A late carer may stay on 1 to 2 hours** past her shift to bridge a night until a main-building carer arrives; nobody stays on overnight.
- **Office and reception staff never call in sick.** Sick calls cover the care and RN slots only (`data/director.json` `absence.slots`). Sanjay missing would need a rule for signing visitors in during office hours.
- **Infection parameters are plausible, not fitted.** Incubation, infectious periods, route weights and rates in `data/director.json` give care-home-like attack rates (norovirus about 38% of residents in the scenario runs), but they aren't fitted to outbreak data. Flu is all-or-nothing: most introductions stop at the index case, some spread widely through people infectious before their symptoms.
- **Outbreaks follow UK guidance per disease** (docs/10): norovirus declared at 2 cases within 48 hours (residents and staff) and over 48 hours after the last case is symptom-free; flu declared at 2 resident cases within 5 days and over 5 days after the last resident onset (UKHSA 2024), with staff cases managed but not counted. An outbreak is declared automatically when the rule is met; in practice the home and its health protection team decide, on a local risk assessment.
- **Visitors and main-building staff don't catch or carry infections yet.** Only residents, the wing's staff and agency workers can. This should be added with the air model: how often visitors are infected is a result the steriliser experiments should report, and the airborne proxy can't give it credibly.
- **No environmental (surface) route.** Staff don't carry an infection from one resident to another except by being infected themselves.
- **Placeholder rates.** The hospital admission rate (3 to 6 a year) has no source yet and must be cited before (c). Flu and norovirus rates are approximate. The airborne route is a proxy until the air model exists; steriliser experiments need the real model.
- **Director-off identity is a fixture.** `test/fixtures/director-off-hashes.json` holds the main-branch fingerprints from 2026-09-30. Any deliberate change to director-off behaviour must re-record it, with the reason in the commit.


## Tuning debt: scheduling rules added to reach zero service breaches (2026-09-29)

In the Lounge and audit-fixes round (M8) these narrow rules were added, beyond what the user asked for, to keep service breaches at zero on every no-fall week. Each one patches a specific clash in the rota rather than modelling something general. The user's decision: occasional breaches on normal days are acceptable and realistic, so no more rules like these. Revisit them all with the scenario director (Phase 2, sub-milestone (e), against the calm-week baseline), and remove any that the director or better staffing models make unnecessary. Everything is in `packages/sim-engine/src` unless stated.

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

**Remaining clashes, reported rather than patched** (seeds 1 to 8, no falls, with Dennis's wash at 08:30 and the RN doing no resident care from 07:45 until the 08:00 round is done):
- 2 service breaches in 56 days: one of Peggy's toilet requests (Sat 19:50, seed 3) and one of Raj's (Fri 20:19, seed 4), both in the evening crunch.
- First food is over 60 minutes after waking for Win, Peggy and Arthur on most mornings. The nurse no longer helps with breakfasts from 07:45, and breakfast opens at 07:30.
- The week tests allow up to 2 reported breaches per no-fall week (user decision).

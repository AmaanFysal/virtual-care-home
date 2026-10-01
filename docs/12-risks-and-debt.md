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
- **Visitors' waiting-area seats depend on how many people exist.** `visitors.ts` picks a seat by the visitor's position in `world.order`, so adding anyone to the world (an agency worker, the main-building carer) moves some visitors to other seats. Harmless, but it's why the main-building carer is added only when first asked for, to keep runs without falls byte-identical. Fix it (a seat chosen by the visitor's own id) with the next deliberate change to director-off runs; left out of the tuning review so its measurements stay comparable.
- **Tuned parameters.** Need rates, priorities and deadline pressure were tuned against these runs (docs/04). They are not measured values.
- **Not generated yet:** PRN (as-needed) medication requests.

## Findings from the scenario director (Phase 2)

- **Care changes after a hospital stay are fixed per cause** (docs/10): for example, after a serious fall always 20% slower, falls risk up and two carers for personal care, for good. Real changes vary by person and recover over weeks; a reassessment after return isn't modelled.
- **Illness is simplified.** Three kinds (chest infection, UTI, dehydration); 40% severe, mild ones 3 to 7 days, the GP within 1 to 4 hours and always admitting a severe case: all assumptions in `data/director.json`. No antibiotics, observations (NEWS2) or deterioration from mild to severe.
- **End of life leaves out** the GP and palliative team, anticipatory medicines, verification of death, the funeral director and relatives staying overnight. The room is empty straight after a death. Checks are hourly during the decline and every 30 minutes in the last 3 days (project owner, 2026-09-30).
- **Dennis's turns drifted into the morning handover once Kamala had moved in** (sub-milestones c and d: 158 of 181 quiet-day breaches over a year). Resolved by the tuning review (below): the only people free for a pressing turn keep to short work, so the floating carer no longer takes Kamala's morning care just before Dennis's 06:50 turn. A few of his turns around 23:30 are still missed now and then, with or without Kamala.
- **Visitors' missed weeks are assumptions** (about 5 a year for a regular visitor, with seasonal causes; docs/10). A visitor who is ill doesn't carry an infection into the home (visitors aren't modelled for infection yet, see below).
- **Celebrations are simple.** Tea and cake is an hour and a log line (with Bev's session when she's on); the cake isn't in anyone's food intake, which matters for the residents with diabetes (Win, Raj and Kamala). Festivals are the four in `data/director.json` (Diwali dates to 2029); others from a card (a name day, Eid, Hanukkah) need a line there. Residents don't go out (to church, the temple or the gurdwara) for them.
- **One admission card.** After Kamala has moved in, a further death in the same run leaves the room empty for good. More cards need drafting and review.
- **A new resident without a character of their own gets a stand-in sprite** (Pat's sheet for women, Bernard's for men), so they look like that visitor when both are on screen. Kamala has her own now; the next card will need one. `spriteClashes` finds any such clash: the audit flags it and the multi-seed report totals the minutes (docs/08).
- **Walking aids are overlays, one frame per direction.** Peggy's zimmer and the walking stick don't move with the walk cycle (the generator has no walking frames for either).
- **The main building has one cover carer, Nikos.** He covers a night nobody else can and helps when everyone is with a fallen resident, but not both at once. He's a man, so on a night he covers, female-only care (Peggy, Kamala) falls to Lorna's rounds.
- **Furniture changed mid-run reaches the browser on reload.** A new resident's bedside chair (or a wheelchair spot removed) is in the engine's floor plan straight away; the canvas draws the floor plan from the snapshot, so it shows after a reconnect.
- **Joining residents move visitors' waiting seats** (see "Visitors' waiting-area seats" above): an admission adds people to the world. Harmless, as before.
- **A round nobody on the wing can give waits for the on-call RN** (25 to 35 minutes; only when a scenario leaves a lead's slot uncovered).
- **A late carer may stay on 1 to 2 hours** past her shift to bridge a night until Nikos arrives from the main building; nobody stays on overnight.
- **Office and reception staff never call in sick.** Sick calls cover the care and RN slots only (`data/director.json` `absence.slots`). Sanjay missing would need a rule for signing visitors in during office hours.
- **Infection parameters are plausible, not fitted.** Incubation, infectious periods, route weights and rates in `data/director.json` give care-home-like attack rates (norovirus about 38% of residents in the scenario runs), but they aren't fitted to outbreak data. Flu is all-or-nothing: most introductions stop at the index case, some spread widely through people infectious before their symptoms.
- **Outbreaks follow UK guidance per disease** (docs/10): norovirus declared at 2 cases within 48 hours (residents and staff) and over 48 hours after the last case is symptom-free; flu declared at 2 resident cases within 5 days and over 5 days after the last resident onset (UKHSA 2024), with staff cases managed but not counted. An outbreak is declared automatically when the rule is met; in practice the home and its health protection team decide, on a local risk assessment.
- **Visitors and main-building staff don't catch or carry infections yet.** Only residents, the wing's staff and agency workers can. This should be added with the air model: how often visitors are infected is a result the steriliser experiments should report, and the airborne proxy can't give it credibly.
- **No environmental (surface) route.** Staff don't carry an infection from one resident to another except by being infected themselves.
- **Approximate rates.** The hospital admission rate (0.70 per resident a year) and stays by cause are sourced (docs/10); the split between illness at home and in hospital, the kinds and the end-of-life decline lengths are assumptions. Flu and norovirus rates are approximate. The airborne route is a proxy until the air model exists; steriliser experiments need the real model.
- **Director-off identity is a fixture.** `test/fixtures/director-off-hashes.json` holds the main-branch fingerprints (re-recorded on main e44f98f on 2026-09-30 with `sim.started`'s `dataVersion` blanked, when Nikos was added to `rota.json`; every other byte of all 8 weeks matched main; re-recorded again for the tuning review, which changes director-off runs on purpose). Any deliberate change to director-off behaviour must re-record it, with the reason in the commit.


## Findings from the full scenario audit (2026-10-01)

The audit (docs/workstreams/sim-audit/report.md) found **45 gaps where features combine: 19 unsafe, 19 unrealistic, 7 cosmetic**, each with a named scenario in `docs/workstreams/sim-audit/cases/`. They are open until fixed in the workstream's PRs B to F (plan.md), on the project owner's decisions (ADR-0007). The worst:

- a fall while an ambulance is on its way for an illness leaves the resident on the floor for good (U1);
- cover can leave no woman on shift, and female-only care then waits hours with nothing to escalate it by day (U2);
- a lone carer is held off urgent work by a two-person reservation nobody can partner, and an evening turn missed before the night shift belongs to nobody (U3, U4);
- the nurse waits with the first serious fall, so others wait up to 2 hours for assessment and 999 (U17);
- a resident on the floor during a round gets no dose and nothing is recorded (U5);
- every calm day: diet texture and Win's fluid limit ignored, visitors in the en-suite, escorts walking ahead (U13 to U16).

Also: docs/11 lists `meds_trained` and `fall_moved_before_assessment` as engine invariants, but `checkInvariants` has neither (the safety monitor does), and the engine's `two_person` check fires falsely for two-person walks (C4, C5).

## Findings from v1.0-testbed PR 1 (2026-10-01)

- **Run time:** the building observer adds about 20% to a run (about 1.6 µs a tick; a week of seed 1 in about 1.15 s against 0.93 s). The two 16-day outbreak replays went past Vitest's 5-second default and now have explicit timeouts.
- **Hoisting is instant in the engine** (a placement), so the world description shows hoisting and being hoisted on that tick only; the care around it is personal care. A timed transfer would be a behaviour change, for later.
- **Windows open rarely in a November run:** the default start is in November, and the window rule needs 12 °C, dry and calm. `START=2027-05-04` (or `--start`) shows them.
- **The sidebar scrolls sideways at 380 px:** the event log's filter row (two selects, the search box and "selected") needs about 412 px. Seen while testing PR 1; not caused by it.

## Tuning debt: the review (sub-milestone e, 2026-09-30)

In the Lounge and audit-fixes round (M8), narrow rules were added, beyond what the user asked for, to keep service breaches at zero on every no-fall week. The user's decision since: occasional breaches on normal days are acceptable and realistic, so no more rules like these. The tuning review switched each off on its own (`createSim({ tuning })`, `scripts/tuning-review.ts`) against the calm-week baseline (seeds 1 to 8, a week each, director off), with a rule kept only if removing it pushed a week over 2 breaches. The removals were then combined and checked on held-out seeds 9 to 16, and three more measures showed things the calm week can't: the same weeks with Kamala in Raj's room (a resident mix the director produces), short-staffed days (4 weeks of the random director against main), and the audit's food and drink flags. Full tables and the rounds: `docs/workstreams/phase-2-director/reports/e-tuning-review.txt`.

**The final decision rule** (approved by the project owner, 2026-09-30): a rule stays if removing it pushes a calm week over 2 breaches on seeds 1 to 8 or 9 to 16, or in the Kamala weeks, or clearly harms short-staffed days (the random director over 4 weeks × 8 seeds), or leaves residents' hunger, thirst or toileting needs unmet in the audit, service target or not. Rules that protect a real care requirement (female-only personal care) stay. All 9 removed rules pass every one of these; the 15 kept each fail at least one. Removing the sole-partner rule and the floating carer's planning together passes calm weeks (at most 2 in a week) but nearly doubles breaches on short-staffed days (64 against 33).

**Kept (15), each switchable in `src/tuning.ts`** (removed on its own, final code: calm breaches in 8 weeks on seeds 1 to 8 and the most in one week; then the measure that decided it):

| Rule | Calm | Why kept |
|---|---|---|
| Pressing reservations are made before any other matching | 35, 6 | Calm criterion |
| Turns pressing 25 minutes ahead, created 30 ahead (before: 15 and 20) | 11, 5 | Calm criterion |
| Lounge: an urgent look-in calls someone back from a break | 11, 4 | Calm criterion |
| A pressing reserved turn's only possible partner keeps to short work | 5, 2 | Calm criterion on seeds 9 to 16 (15 breaches, 4 in a week) |
| The floating carer plans back-to-back turns; turns due 06:45 to 07:30 planned for 06:45 | 9, 2 | Short-staffed days: 70 breaches in the 4-week random runs without it, against 33 |
| Turns due 20:00 to 21:30 moved to 19:45 | 0, 0 | Short-staffed days: 48 against 33 |
| The briefing starts when both are free; the first free keeps to short work | 0, 0 | Short-staffed days: 50 against 33 (the lead stood waiting in the briefing while checks fell due) |
| **New:** nobody starts long care that a two-person turn they're needed for would fall due during; the only people free for a pressing turn keep to short work | 2, 1 | The Kamala weeks: 14 breaches (3 in a week) without it, against 1 (below) |
| Breakfast gets the same time-awake boost as morning care | 1, 1 | Audit: without it Arthur is hungry (need over 0.8) 33 times in 8 weeks, against 3 |
| Tea on waking has a hard deadline | 2, 1 | Audit: first drinks |
| A drink with the 08:00 tablets for anyone who hasn't had tea | 1, 1 | Audit: without the two tea rules, Stan's first drink comes 23 to 33 minutes after he wakes at 08:00 on most days (42 flags) |
| Breakfast offered first holds morning care until they've eaten | – | Audit (project owner, 2026-09-30): residents' food |
| Female-only care +25; the only woman on shift −30 for two-person work while female-only care is pending; a break waits for the only woman | – | A real care requirement (Peggy, Kamala) and the audit: Peggy's toileting need over 0.8 8 times in 8 weeks without them, 3 with them (project owner, 2026-09-30) |

**Removed (9):** a reserved task waiting for its reserver; a turn reserved while its resident is briefly busy; someone on a break holding a reservation; Dennis's morning care taking on a turn; the toilet prompt skipped before morning care; turns not interrupting a medication round (a turn within 10 minutes of its limit now may); anyone on a day break called back during a fall; the Lounge two-person wait; the Lounge break stagger. (The breakfast-first hold and the three female-only rules were removed in the first version of the review and put back on the project owner's decision.)

**Also changed by the review (general rules and fixes, not tuning):**
- **Dennis's turns before the morning handover** (the (d) finding). Two mechanisms, both a 20-minute wash started just before a two-person turn: with a male night carer, Kamala's female-only morning care waited for the floating carer, who arrived at 06:35 for Dennis's 06:50 turn and took Kamala's care instead (nobody had reserved the turn, so the sole-partner rule didn't apply); with a female night carer, she started Kamala's care at 06:04 with his turn due at 06:24, before the floating carer (and the turn's task) arrived. The new rule above covers both (a resident's own request for help is never held back for it): over a year of the random director, 2 of Dennis's turns missed between 06:00 and 07:00 with no emergency behind them, against 158. A lone night carer with an early-waking resident can't do everything before the handover, so a few checks at 06:45 to 06:50 are missed instead (reported).
- **Floor cover for a day break or going home counts only staff on a shift**, not helpers who leave when their job is done: two carers had started breaks relying on the floating and main-building carers, who then left (a hard `floor_cover` violation during falls).
- **An ill agency worker is kept in the world until they've recovered**, so their recovery is logged.
- **Logged events no longer change after they're emitted:** `outbreak.declared` shared its case list with the live outbreak (later cases showed up in it), and Bev's tea session shared its resident list with `activity.started`.

**Results (final rule set), before and after putting back the breakfast-first hold and the female-only rules** (project owner, 2026-09-30; also: a resident's own request for help is never held back by the new turn rule):

| | Main (before the review) | Review, first version (11 kept) | Final (15 kept) |
|---|---|---|---|
| Calm weeks, director off: breaches, seeds 1 to 8 / 9 to 16 | 2 / – | 1 / 2 | 0 / 1 |
| With Kamala in: seeds 1 to 8 / 9 to 16 | 15 / – | 1 / 1 | 1 / 3 |
| Three-falls sets: seeds 1 to 4 / 9 to 12 | – | 35 / 43 | 37 / 39 |
| Short-staffed days: random director, 4 weeks × 8 seeds | 38 | 33 | 30 |
| A year of the random director, seeds 1 to 8 | 469 ((d)) | 403 | 388 |
| … on days without a director event | 181 | 124 | 131 |
| … Dennis's turns missed with no emergency (06:00 to 06:59) | 170 (158) | 31 (3) | 41 (2) |
| Hard violations, every run | 0 | 0 | 0 |
| Audit flags (director off, seeds 1 to 8) | 142 | 165 | 153 |
| … late first food | 100 | 121 | 120 |
| … toileting need over 0.8 | 15 | 30 | 18 |
| … hunger need over 0.8 | 0 | 2 | 6 |
| … late first drink | 3 | 0 | 0 |
| … morning care out of wake order | 9 | 8 | 4 |

- The director-off golden fixture was re-recorded: the review changes director-off runs on purpose (approved).
- **Still worse than main in the audit:** late first food (120 against 100: Arthur, Peggy, Win) and Arthur's hunger (6 episodes in 8 weeks). Putting back the breakfast-first hold didn't move late first food; the remaining difference comes from the other changes together (the removed rules, the new turn rule and floor-cover rule), which shift morning timings. Raj's toileting episodes are mostly while he's being helped with lunch, supper or his morning care (one thing at a time).
- Test tolerances changed: an end-of-life decline may miss one 30-minute check every two days (misses in the morning rush are reported, not failures), and its last days may begin up to 30 minutes late (after care in progress); the outbreak scenario tests allow one outbreak still running when the run ends (on seed 1 the flu now spreads further and a second outbreak starts on day 19); the turn-rule test expects at least 2 misses without the rule.

## Known audit regressions from the tuning review (open, 2026-09-30)

The tuning review (sub-milestone e) kept every service target and hard rule at or better than before, but three things in the behaviour audit (director off, seeds 1 to 8, a week each) are still worse than on main before the review:

- **Late first food: 120 flags against 100**, for Arthur, Peggy and Win: breakfast comes more than an hour after they wake more often. Putting back the breakfast-first hold didn't move it; the difference comes from the combined changes (the removed rules, the new turn rule and the floor-cover rule), which shift morning timings.
- **Arthur's hunger: 6 episodes over 0.8 in 8 weeks, against none**, the same mornings.
- **Raj's toileting: 18 episodes over 0.8 against 15**, mostly while he's being helped with lunch, supper or his morning care, when a toilet request waits because a resident has one thing done at a time.

None of these is a service target, so they don't show as breaches. **Planned fix, a later milestone after v1.0-testbed (docs/roadmap.md):** either a shared daily planner (one plan for each resident's morning, meals and care instead of competing task scores), or pre-meal toileting rounds (a toilet offered before lunch and supper) with a review of the morning routine (wake order, breakfast and washes). Measured with the audit as well as the service targets, as the tuning review was.


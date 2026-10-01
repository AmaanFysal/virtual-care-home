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
- **Dennis's turns drifted into the morning handover once Kamala had moved in** (sub-milestones c and d: 158 of 181 quiet-day breaches over a year). Accepted: the tuning rule that fixed it was removed on 2026-10-01 (below), so some of his turns are a few minutes late.
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


## Findings from v1.0-testbed PR 1 (2026-10-01)

- **Run time:** the building observer adds about 20% to a run (about 1.6 µs a tick; a week of seed 1 in about 1.15 s against 0.93 s). The two 16-day outbreak replays went past Vitest's 5-second default and now have explicit timeouts. With PR 2's equipment and touches, about 65% (1.5 s a week); the equipment rules are most of it (lights checked for every room every tick).
- **Hoisting is instant in the engine** (a placement), so the world description shows hoisting and being hoisted on that tick only; the care around it is personal care. A timed transfer would be a behaviour change, for later.
- **Windows open rarely in a November run:** the default start is in November, and the window rule needs 12 °C, dry and calm. `START=2027-05-04` (or `--start`) shows them.
- **The sidebar scrolls sideways at 380 px:** the event log's filter row (two selects, the search box and "selected") needs about 412 px. Seen while testing PR 1; not caused by it.

## Findings from v1.0-testbed PR 2 (2026-10-01)

- **Touches are one per action, not continuous contact:** about 650 a day, against the spec's estimate of 5,000. Each action records its touches as it starts (a bed rail as the wash begins, a cup as a drink is served); hands on surfaces through a 20-minute wash aren't counted again. A contact model that needs a rate per minute would have to be built on this, or the rule changed.
- **Touches only in reach:** opening a window or switching the kettle on is a touch only when the person is within 1.5 m (the engine doesn't walk them over). Lounge windows opened by someone at the door aren't touched.
- **Lights are rules, not people's choices:** a light goes off when nobody awake is left in the room, and a resident's own light isn't left on for company or by habit.
- **The map's darkness now follows the real daylight,** so November evenings go dark from about 16:30 rather than 20:00.

## Care perfection removed (2026-10-01)

The project's goal is activity data for external models, not flawless care (docs/roadmap.md). So the full scenario audit (safety monitor, fuzz runner, named cases), the 15 tuning rules (narrow scheduling rules added to keep calm weeks at zero service breaches), the tuning review script, the behaviour audit (`sim --audit`) and the tests that measured service targets were removed. All of it is at the tag `v0.10.0-pre-simplify`.

**Kept from the audit's PR B, because they change who is where (the activity data):** a fall while an ambulance is coming goes on the same call, so nobody is left on the floor for good (U1); staff taken ill stop care, are relieved and go home, and symptoms on arrival send them home (U11, with the fixes around it: a night carer taken ill brings the floating carer, a handover's floor cover taken ill, a round taken from an ill giver goes to someone meds-trained); visitors wait by the bed while the resident is in the en-suite (U13); escorts walk beside the resident (U16); 999 at once for a serious fall, the nurse hands over the wait, and every call gets its own crew (U17, R17); night bridge cover isn't double-booked; a resident admitted during a round is on it. **Removed from PR B (care quality only):** delayed doses recorded and given later (U5), time-critical doses within 30 minutes and undisturbed (U6), and whoever gives the next round starting no long care in the 15 minutes before it. Tests: `test/presence.test.ts`.

**What it costs:** about 2 to 3 turns a day for Dennis and Raj done a few minutes past their interval, and the odd Lounge look-in late (a calm week: 12 to 21 late turns and 0 to 3 look-ins on seeds 1 to 8). **What holds:** no hard rule breaks (`invariant.violated`) in 8 calm weeks or 32 weeks with the random director. Female-only personal care and two-person tasks are still enforced as rules; only the scoring tweaks around them went. Service breaches stay in the event log as `sla.breached`; nothing tries to hold them at zero.

## Hosting (2026-10-01, ADR-0008, docs/13)

- **One machine, one disk.** A deploy or a host restart means 10 to 30 seconds without the stream, and the volume lives in one region. Fly keeps daily volume snapshots for 5 days. There's no second instance: the world is one process.
- **Any engine or data change ends the public run** on its next deploy (a fresh run the next sim morning, by decision). Server-only changes resume.
- **Snapshots rely on the engine keeping all its state in `World`** (or deriving it from data, like the weather and equipment caches). New state anywhere else would break restore; `test/snapshot.test.ts` catches it.
- **v8's serialisation format** belongs to Node. A Node upgrade in the image comes with a deploy, and an unreadable snapshot falls back to the one before, then to a fresh run.
- **One admin token, sent over the socket** (WSS only). A leaked token is replaced with `fly secrets set`. There are no per-person accounts.
- **Viewers see everything the event log shows,** including the director's plans for the day (`director.planned`).


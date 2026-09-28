# Workstream spec: Phase 0 + Phase 1 (rules-only MVP)

**Goal:** a believable wing running on rules alone, with coloured circles, that you can watch and control. No LLM. If the world isn't believable with rules, no prompt will save it.

Source: [plan-v2](../../research/plan-v2.md) (Revised roadmap, What to do first). Constraints: [00-constitution](../../00-constitution.md).
Status: **agreed 2026-09-28**. Tasks are in [plan.md](plan.md).

## Phase 0: Design

- JSON floor plan: rooms (with floor area and ceiling height), walls, doors, furniture and named points → [02](../../02-world-model.md)
- Rota, handovers, routine and care rules → [05](../../05-care-operations.md)
- Persona cards for the 10 staff, 6 residents and 25 visitors → [06](../../06-personas-and-families.md)
- Event and input schema (with `source`) → [07](../../07-events-and-persistence.md)

## Phase 1: Rules-only MVP

- Tick engine and sim clock: pause, step, 1x, 10x, 60x, 360x → [03](../../03-simulation-engine.md)
- Rota, handovers and breaks → [05](../../05-care-operations.md)
- Needs (hunger, thirst, toileting, fatigue, social; staff workload) with utility decisions → [04](../../04-agents-and-behaviour.md)
- Behaviour trees for morning personal care, med round, meal service, fall response and night checks → [04](../../04-agents-and-behaviour.md), [05](../../05-care-operations.md)
- Visitors arriving from their visit patterns → [05](../../05-care-operations.md)
- A* movement on the server, with per-person speeds and a doorway wait rule → [04](../../04-agents-and-behaviour.md)
- SQLite append-only event and input log → [07](../../07-events-and-persistence.md)
- Fastify + WebSocket server; React + PixiJS canvas, follow, inspector, clock controls and event log panel → [08](../../08-realtime-and-ui.md)
- Vitest invariants, golden fall tests, determinism test → [11](../../11-testing.md)

## Decisions

1. **Time.** One engine tick = 5 sim seconds. Movement and behaviour-tree steps run every tick. Needs, rota, visitor arrivals and utility decisions run every 12th tick (once a sim minute). The server's pacer maps speeds to ticks per real second (1x = 0.2, 10x = 2, 60x = 12, 360x = 72). The engine never reads wall-clock time. [ADR-0001](../../adr/0001-five-second-tick.md)
2. **Calendar.** Sim time is integer seconds since Monday 2026-11-02 00:00. Runs start Tuesday 2026-11-03 at 06:00 (t = 108000).
3. **Storage.** SQLite through `node:sqlite` (Node >= 22.13), one file per run, with append-only `events` and `inputs` tables. Postgres + pgvector arrives in Phase 2. [ADR-0002](../../adr/0002-sqlite-event-log-phase-1.md)
4. **Floor rule.** At every tick at least one on-duty care staff member is inside the wing, outside the staff room and not on a break. At each handover one carer (outgoing or incoming) covers the floor. At 07:00 the lone night carer hands over, so an incoming early carer covers and is briefed afterwards.
5. **Breaks.** A sole carer (nights) takes the break inside the wing (waiting area), not in the staff room, and stays interruptible, so they still count as on the floor. Day breaks are staggered so the floor rule holds.
6. **RN cover.** Maria works long days (07:00 to 19:30) on Tue, Wed and Thu. On other days the day RN is a generated agency nurse (grey, meds-trained, can assess falls, no resident knowledge). From 19:30 to 07:00 the RN is on call, off the map.
7. **Rota.** A hand-written 7-day rota (`data/rota.json`). Slots the 10 staff can't cover are filled by generated agency carers (grey, no resident knowledge, not meds-trained).
8. **Falls.** Falls happen only through a user `inject_fall` input {resident, severity: minor | serious}.
   - **Day:** the RN attends and assesses before anyone moves the resident.
   - **Night:** the night carer does a first check, then calls the on-call RN (the call counts as the assessment and takes a few sim minutes). If the RN clears the resident to be moved, the floating night carer is called out (decision 16), arrives within about 10 minutes, and the two lift together. If the RN says to wait for an ambulance, the carer keeps the resident comfortable on the floor (pillow, blanket) and stays with them; paramedics arrive after a seeded delay.
   - **Outcome:** a minor fall ends with the resident back in bed or their chair. A serious fall means 999, paramedics, conveyance to hospital (the resident leaves the map and the bed shows "in hospital") and a `cqc.notification_flagged` event. The family is phoned after every fall.
   - Off-map arrivals and departures are logged as events.
9. **Med rounds.** 08:00, 13:00 and 17:00 are done by the RN; 21:00 by the late senior before handover. Rounds can be interrupted and resume where they stopped. Each interruption raises the seeded chance of a late or missed dose, which is logged. There are no routine meds at night; a night PRN request goes through the on-call RN.
10. **Help requests.** A dependent resident emits `resident.requested_help` when a need crosses its threshold (no call-bell device is modelled). Requests join a wing task queue that staff utility scores alongside scheduled work. Dennis can't ask, so he relies on checks and repositioning. Response time is tracked.
11. **Visitors.** All 25 are sampled per sim day from `visit_pattern` + reliability with the seeded RNG. They arrive at the exit door, sign in at reception (or ring the bell out of hours so a carer lets them in), go to the resident's bedside or the waiting area, stay, sign out and leave. No moods or conflicts yet.
12. **Personas.** Residents and staff use the full v1 schema. Visitors get a lighter card. Rules read only the mechanical fields.
13. **Initial state (Tue 06:00).** Florin is on night duty, residents are asleep in bed, and night checks are already on schedule (last-check times seeded within each resident's interval).
14. **Determinism.** Event ids come from the event sequence number. No event carries wall-clock time. User inputs are logged with the tick they apply at, so replaying seed + inputs reproduces the run.
15. **No equipment entities.** The hoist and the med trolley are implied by the procedure (badges only), not modelled as objects, per constitution rule 4.
16. **Floating night carer.** A female carer from the main building (off the map) visits on planned rounds at 22:00, 00:00, 02:00, 04:00 and 06:00, aligned with Dennis's turns. Each round batches Dennis's turn, Raj's repositioning if due, and Peggy's personal care if due (female carers only; the male night carer still does her checks). Outside rounds she is called only for urgent two-person or same-sex tasks. Arrivals and departures are logged; out-of-round call-outs are a metric.

## Invariants (every tick, in tests; logged as `invariant.violated` at runtime)

1. At least one on-duty care staff member on the floor (decision 4).
2. No resident unchecked beyond their care-plan check interval.
3. No two-person task (Raj's transfers, a hoist lift after a fall) carried out by one person.
4. No visitor in the staff room.
5. Only meds-trained staff (RN, senior carers, agency nurse) administer medication.
6. No fallen resident moved before assessment.
7. An RN is always reachable: on the map by day, on call off the map at night.

## Acceptance: Phase 1 is done when

One sim day (Tue 06:00 → Wed 06:00), run headless and unpaced on seed 1:

- all three handovers happen, with at least one carer on the floor during each;
- four med rounds complete, and a meds-trained carer does the 21:00 round;
- three meals are served and every resident gets morning personal care;
- Raj's transfers always use two staff;
- 3 to 8 visitors are on site in mid-afternoon (14:30 to 16:30);
- night checks happen at each resident's interval;
- zero invariant violations;
- the fall golden tests pass (06:40 and 02:00, minor and serious);
- running the same seed twice gives a byte-identical event log.

Manual check: watching 30 sim minutes at 10x around 07:30 (care rush) and 15:00 (visiting peak) shows no teleporting, no people stacking in doorways and nobody walking through walls.

## Out of scope

LLM minds (Phase 2); the base-rate director, scenario cards and a spontaneous fall rate (Phase 3); return from hospital (Phase 3); visitor moods, conflicts and off-screen family life (Phase 4); snapshots, replay UI and branching (Phase 4); sensors, equipment and air quality (not v1).

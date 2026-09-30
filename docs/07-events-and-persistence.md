# 07 · Events and persistence

**Purpose:** the event and input schema, the internal event bus, the append-only event log, snapshots and replay.

> Status: decided for Phase 1 (2026-09-28). Source: [plan-v2](research/plan-v2.md) (Backend architecture, Built to extend later), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §4. Decision record: [ADR-0002](adr/0002-sqlite-event-log-phase-1.md). Types: `packages/shared-types`.

Fixed: every event carries `source`: `engine` | `director` | `user` | `llm` | `external` (see [00](00-constitution.md)).

## Event envelope

```ts
interface SimEvent {
  id: string;          // "e" + seq, e.g. "e1042"; derived, never random
  seq: number;         // 1, 2, 3 ... per run, gap-free
  tick: number;        // engine tick the event happened on
  t: number;           // sim seconds since Mon 2026-11-02 00:00
  type: EventType;     // "resident.fell", "shift.started", ...
  actors: string[];    // person ids involved, primary actor first
  payload: object;     // type-specific, serialisable, ids not object references
  source: Source;      // engine | director | user | llm | external
}
```

- No wall-clock time appears in any event.
- Events caused by an input inherit the input's `source`. An injected fall's `resident.fell` has `source: "user"`; everything the engine does in response has `source: "engine"`.
- Positions are not logged (a sim day has 17,280 ticks × 41 people). The log records room entries, task steps and outcomes; the WebSocket deltas carry positions.

## Inputs

```ts
interface SimInput {
  seq: number;         // per run, gap-free
  applyTick: number;   // tick at which the engine applies it
  type: "inject_fall" | "staff_sick" | "shift_no_show";
  payload: object;     // inject_fall: { residentId, severity: "minor" | "serious" }
                       // staff_sick: { staffId, cover?: "auto" | "bank" | "agency" | "none" }
                       // shift_no_show: { slot, cover? }
                       // infection_case: { personId, disease: "norovirus" | "flu" }
  source: Source;      // "user" from the server; "director" when the scenario director plans it
}
```

Manual inputs arrive from the browser (`inject_fall` from the inspector, `inject {input, params}` from the Director panel) and are logged in the `inputs` table before the engine sees them. The scenario director's inputs are planned inside the engine from the seed, the director settings and the scenario file, and logged as `director.planned` events rather than in `inputs` (docs/10).

Clock commands (pause, step, set_speed) and inspect requests are not inputs: they cannot change the run. The server records them in the `commands` table for audit only.

## Naming

`<subject>.<past_tense_verb>`, lower snake case after the dot: `resident.fell`, `shift.started`, `visitor.signed_in`.

## Phase 1 catalogue

| Area | Types |
|---|---|
| Run | `sim.started` {seed, startT, dataVersion} |
| Presence | `person.arrived`, `person.departed` (on/off the map via ExitDoor; a resident conveyed to hospital departs from their bed), `person.entered_room` {roomId, fromRoomId} (every room change: walking, a hoist or transfer, arriving), `person.waited_at_door` {doorId}. Room occupancy can be rebuilt exactly from these (the audit checks it every tick) |
| Rota | `shift.started`, `shift.ended` {staffId, shift}, `agency.spawned` {role, shift}, `break.started`, `break.ended`, `rn.on_call_started`, `rn.on_call_ended` |
| Handover | `handover.started`, `handover.completed` {from, to, floorCover, summary} |
| Needs and tasks | `resident.requested_help` {need}, `task.created`, `task.assigned`, `task.started`, `task.interrupted`, `task.resumed`, `task.completed` {taskId, kind, residentId?, waitMins}. Scheduled care kinds are `care.morning`, `care.bedtime`, `care.check`, `care.reposition`, `care.meal`, `care.pad_change`; also `round`, `handover`, `briefing` |
| Care | `care.made_safe` {residentId, staffId, care, position: `lying in bed` or `seated`, covered, reason} (personal care left for a fall), `resident.woke` {reason}, `resident.fell_asleep` {where: bed, chair or lounge}, `care.personal_care_done`, `resident.got_up`, `resident.went_to_bed`, `resident.checked`, `resident.repositioned`, `resident.transferred` {staffIds, method} |
| Meals | `meal.served` {meal}, `drink.served` {round: a drinks round, `waking` (tea on waking), `with_meds` or `top_up` (replacing a stale or owed drink); outcome: `drunk`, `left` (by the bed, stale after 2 hours) or `owed` (needs help to drink, given at the next contact)}, `intake.recorded` {mealPct?, fluidsMl?} |
| Activities | `activity.started`, `activity.ended` {staffId, activity, roomId, residentIds} (Bev's Lounge sessions) |
| Meds | `med_round.started`, `med_round.completed`, `med.administered`, `med.late`, `med.missed`, `med.prn_requested` |
| Falls | `resident.fell` {severity} (source of the input: `user` or `director`), `fall.found`, `fall.help_requested` {reason, called: `floating_carer`, `on_call_rn`, `on_the_way` or `next_free`} (nobody could come yet), `fall.made_comfortable` {staffId, reason} (left, assessed and not injured, while their carer helps with another lift), `fall.checked` {staffId, sinceMins} (a look-in on someone left waiting), `main_carer.called` {reason, available, arriveT}, `main_carer.arrived`, `main_carer.departed` (a carer from the main building when everyone here is with a fallen resident), `fall.rn_called`, `fall.assessed` {outcome}, `fall.lifted`, `ambulance.called`, `paramedics.arrived`, `resident.conveyed_to_hospital`, `resident.returned_from_hospital` {daysAway}, `fall.observations_ended`, `family.informed`, `incident.recorded`, `cqc.notification_flagged` {regulation, reason} |
| On-call RN | `on_call_rn.called` {residentId (null when she comes for a medication round), reason}, `on_call_rn.arrived` {personId, residentId}, `on_call_rn.departed` (serious falls with no RN on the wing) |
| Off-map help | `second_carer.called` {reason, residentIds, outOfRound}, `second_carer.arrived` {personId, planned}, `second_carer.departed` (the floating night carer) |
| Visitors | `visit.planned` {visitorId, residentId, arriveT, durationMins}, `visitor.rang_bell`, `visitor.let_in` {staffId}, `visitor.signed_in` {staffId: the receptionist, the carer who let them in, or `visitors_book`}, `visit.started`, `visit.ended`, `visitor.signed_out`; the "answer the door" task is `task.created` with kind `let_in` |
| Director (Phase 2) | `director.day_planned` {day, dayType, planned, suppressed, downgradedFrom?}, `director.planned` {inputType, applyT, origin: `random` or `scenario:<id>`, reason, params}, `director.suppressed` {inputType, applyT, reason, params} (held back by a pacing cap), `input.skipped` {inputType, reason, params} (any source: an input that couldn't apply) |
| Infection (Phase 2) | `infection.exposed` {personId, disease, route: `contact`, `airborne (proxy)` or `introduced`, sourceId, roomId}, `infection.symptomatic` {personId, disease, roomId}, `infection.recovered`, `infection.isolated` {personId, disease, roomId}, `infection.isolation_ended`, `outbreak.declared` {disease, cases}, `outbreak.over` {disease, cases, days}, `visit.cancelled` {visitorId, residentId, reason} |
| Health (Phase 2) | `illness.started` {residentId, kind: `chest_infection`, `uti` or `dehydration`, severity}, `illness.recovered`, `gp.consulted` {residentId, outcome}, `ambulance.called` and `resident.conveyed_to_hospital` and `resident.returned_from_hospital` with {cause} (`serious_fall` or an illness), `resident.care_changed` {residentId, reason, changes, untilT} (an override on the run's copy of the card), `end_of_life.started` {residentId, expectedDays}, `resident.died` {residentId, roomId}, `resident.admitted` {residentId, roomId, cardId} |
| Visitors and celebrations (Phase 2) | `visitor.week_off` {visitorId, residentId, cause: `holiday`, `illness` or `family`, untilT}, `visit.cancelled` with reason "week off (…)", `celebration.started` {kind: `birthday` or `festival`, name, residentIds, gathering, reason?}, `celebration.tea` {name, roomId, staffId (Bev, or null with the carers' afternoon tea), residentIds, visitorIds} (everyone who came, logged when tea ends); Bev's tea is also an `activity.started`/`activity.ended` session |
| Staffing (Phase 2) | `staff.absent` {staffId, name, slot, shift, reason: `sick`, `no_show` or `went_home_sick`, shiftStartT}, `rota.cover_booked` {slot, shift, forStaffId, cover: `bank`, `agency`, `main_building` or `stay_on` (with `untilT`), staffId, arriveT}, `rota.no_cover` {slot, shift, forStaffId, reason}, `med_round.no_giver` {round} |
| Checks | `invariant.violated` {rule, details}: a hard safety rule broke (must never happen); `sla.breached` {target: `request_wait`, `resident_check`, `reposition`, `lounge_supervision`, `fall_attendance` or `fall_waiting_check`, residentId, details, cause}: a service target was missed (reported; causes are a fall, short staffing ("short-staffed: Tom off sick (early), agency from 08:16"), or "no emergency", where for the Lounge the cause lists what each carer was doing). Both logged by the engine when the condition starts |

New types follow the `new-event-type` skill and are added here.

## Storage (Phase 1: SQLite)

One database file per run: `runs/<runId>.sqlite` (git-ignored).

| Table | Columns | Notes |
|---|---|---|
| `run` | run_id, seed, start_t, data_version, created_wallclock, director | One row. The wall-clock creation time is server metadata, never read by the engine. `director` is `off` or JSON: mode, random, scenario id, a hash of the scenario and of `data/director.json`, deaths |
| `events` | seq (PK), tick, t, type, actors (JSON), payload (JSON), source | Append-only; one transaction per tick |
| `inputs` | seq (PK), apply_tick, type, payload (JSON), source | Append-only; written before the engine sees the input |
| `commands` | id, tick, type, payload (JSON) | Clock and inspect commands, audit only |

## Replay

Seed + data version + the director settings and scenario (from the `run` row) + the ordered `inputs` reproduce the run exactly. A scripted scenario replays to a byte-identical log (`test/director.test.ts`). The determinism test runs the same seed and inputs twice and compares the event logs byte for byte.

Snapshots and branching (restore state at a tick and run a what-if) are Phase 4.

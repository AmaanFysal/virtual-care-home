# 04 · Agents and behaviour

**Purpose:** the body layer: needs and utility AI, behaviour trees for care procedures, simple state machines, and movement.

> Status: movement (M2), needs, tasks, utility and the behaviour-tree runtime (M4a) and the care schedule (M4b) built, 2026-09-28. Med rounds and falls come in M5. Source: [plan-v2](research/plan-v2.md) (Agent architecture), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §2.

## Needs (`src/needs.ts`, once per sim minute)

Residents have five needs from 0 (fine) to 1 (urgent): hunger, thirst, toileting, fatigue, social. Each rises at an hourly rate that is slower asleep; fatigue falls asleep. Meals, drinks rounds and scheduled care meet most needs (docs/05); requests cover the rest.

| Need | Hours 0→1 awake / asleep | Acted on at |
|---|---|---|
| Hunger | 6 / 40 | 0.85 |
| Thirst | 4 / 16 | 0.75 |
| Toileting | 3 / 6 | 0.75 (wakes a sleeper at 0.9) |
| Fatigue | 15 / falls over 7 | (drives sleep only) |
| Social | 6 / – | 0.85 |

- **Sleep** follows each resident's routine (bed to wake time, plus a 45-minute nap). A resident dozes off in bed or sitting in their chair once every need is settled; toileting at 0.9 wakes them (`resident.woke`, `resident.fell_asleep`). A drink left by the bed is drunk on waking.
- **Acting on a need:** the most pressing need over its threshold wins. Independent walkers (Win, Arthur, Stan) take themselves to the WC and back (`self_toilet` task). Everyone else who can ask raises a help request (`resident.requested_help` → an `assist` task). Dennis can't ask; his care is scheduled (M4b).
- Needs start near their Tuesday 06:00 values with a little seeded variation.

## Tasks and utility (`src/tasks.ts`)

- **Task kinds:** `assist` (a help request, or Peggy's scheduled toilet prompt), `care` (scheduled bedside care: morning, bedtime, check, reposition, meal, pad change), `round` (drinks round), `self_toilet` (a resident's own trip), `handover`, `briefing`, `break`. Each has a behaviour tree (`trees.ts`) and a status (open, active, paused, done).
- **Assist details** come from the care profile: toileting for someone in pads is a bedside pad change with `personal_care_staff` people (2 for Raj, with the hoist badge); for Peggy it is an escort to the WC and back (female carers only); drinks 3 min (+200 ml fluid), snacks 5, chats 10.
- **Utility matching** (each minute): every free care worker is scored against every open task: `base priority + 1.5 × minutes waiting (+ 100 × need for requests) + 60 if within 15 minutes of its deadline − 3 × metres away + 10 × resident's trust in them − 25 if an RN − 10 if on an interruptible break`. Base priorities: toilet prompt 90, turn and pad change 85, meal 75, check and drinks round 70, morning and bedtime care 60, requests 40. The best (task, staff) match is taken repeatedly until none is left. A resident only has one thing done with them at a time.
- **Two-person tasks** start only when two eligible staff are at the resident. By day, if one has waited 5 minutes and only one person is free, that person holds it at the bedside until a partner is free; **only one task may be held like this at a time** (two carers each holding a different one would wait for each other for ever). Female-only tasks only go to women.
- **Absorbing requests:** when scheduled care starts with a resident who has a waiting request, the care takes it over: help counts as started, and the need is met when the care finishes.
- **Handovers and briefings** claim their named members as soon as they are free. **Breaks** start when due if another *carer* (not the RN) covers the floor; a sole night carer's break is in the waiting area and is paused for any assist, then resumed.
- **Idle staff** wait at their floor post (leads and night carer `Corridor.Mid`, CAs `Corridor.West`, RN `Corridor.East`); office and reception staff at their workplaces.
- **Workload** is a rolling share of the last hour spent on work (shown in the inspector).
- Every task logs `task.created`, `task.assigned`, `task.started`, `task.completed` (with `waitMins` from request to start) or `task.interrupted`.

## Behaviour trees (`src/bt.ts`)

A small hand-rolled runtime: `seq` and `sel` composites with memory (a sequence resumes at the child it was on), and leaves (`act` instant, `cond` check, `until` wait for a condition, custom leaves with their own memory). A tree definition is static TypeScript; each running task stores only plain data (child cursors, per-leaf memory, last node name), so state stays serialisable. The inspector shows the current node.

## Movement (decided, `packages/sim-engine/src/world/`)

- **Pathfinding:** hand-written A* on the 0.5 m grid (`pathfind.ts`): 8-connected, no corner-cutting, octile heuristic, ties broken by f, then h, then cell index, so paths are reproducible. Chosen over easystar.js, whose async API fights determinism.
- **Speeds:** from the persona cards (staff 1.2 m/s, Peggy 0.4, Win 0.5, Arthur 0.45, Stan 0.6; Raj and Dennis 0, moved by staff). People advance `speed × 5 s` along their path each tick; the browser interpolates.
- **Doorway wait rule:** the cells either side of each door gap form a single-occupancy zone. A person claims the zone to step into it and releases it on reaching the first cell beyond; anyone else waits at the edge (`person.waited_at_door`, emitted once per wait). A zone used during a tick stays closed until the next tick, so two people never cross the same doorway within 5 seconds. People may otherwise overlap (no local avoidance in rooms or the corridor).
- **Entering and leaving the map:** people appear at `ExitDoor` one at a time as its doorway clears (`person.arrived`), and leave from it (`person.departed`).
- **Standing spots:** everyone who stops somewhere claims that grid cell, and a person walking somewhere claims their destination cell when they set off. If a destination's cell is taken, they go to the nearest free cell in the same room (never a doorway cell). So two people never stand on the same cell; this is a per-tick invariant. The exit door isn't claimed (people pass through). Residents in bed lie on the bed cell, which nobody can walk to.
- **Room entries** are logged (`person.entered_room`) for every room a path passes through, even within one tick.


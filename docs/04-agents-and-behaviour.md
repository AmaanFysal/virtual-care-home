# 04 · Agents and behaviour

**Purpose:** the body layer: needs and utility AI, behaviour trees for care procedures, simple state machines, and movement.

> Status: movement decided and built (M2, 2026-09-28); needs, utility and behaviour trees to come in M4a/M4b. Source: [plan-v2](research/plan-v2.md) (Agent architecture), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §2.

## To be decided

- Needs list and decay curves (hunger, thirst, toileting, fatigue, pain, social, comfort; staff workload and stress).
- Utility AI tuning and anti-dithering (hysteresis, commitment time).
- Behaviour tree implementation: hand-rolled or a library; how trees are authored and tested.
- Interrupt and resume semantics (a med round interrupted by a fall; error chance rising with interruptions).
- Staff task allocation: simple task queue vs GOAP / HTN (optional in the plan).
- Multi-agent tasks (two-person hoist transfer) and how two agents coordinate.
- The first five trees: morning personal care, med round, meal service, fall response, night check.

## Movement (decided, `packages/sim-engine/src/world/`)

- **Pathfinding:** hand-written A* on the 0.5 m grid (`pathfind.ts`): 8-connected, no corner-cutting, octile heuristic, ties broken by f, then h, then cell index, so paths are reproducible. Chosen over easystar.js, whose async API fights determinism.
- **Speeds:** from the persona cards (staff 1.2 m/s, Peggy 0.4, Win 0.5, Arthur 0.45, Stan 0.6; Raj and Dennis 0, moved by staff). People advance `speed × 5 s` along their path each tick; the browser interpolates.
- **Doorway wait rule:** the cells either side of each door gap form a single-occupancy zone. A person claims the zone to step into it and releases it on reaching the first cell beyond; anyone else waits at the edge (`person.waited_at_door`, emitted once per wait). A zone used during a tick stays closed until the next tick, so two people never cross the same doorway within 5 seconds. People may otherwise overlap (no local avoidance in rooms or the corridor).
- **Entering and leaving the map:** people appear at `ExitDoor` one at a time as its doorway clears (`person.arrived`), and leave from it (`person.departed`).
- **Room entries** are logged (`person.entered_room`) for every room a path passes through, even within one tick.


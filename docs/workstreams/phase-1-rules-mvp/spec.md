# Workstream spec: Phase 0 + Phase 1 (rules-only MVP)

**Goal:** a believable wing running on rules alone, with coloured circles, that you can watch and control. No LLM. If the world isn't believable with rules, no prompt will save it.

Source: [plan-v2](../../research/plan-v2.md) (Revised roadmap, What to do first). Constraints: [00-constitution](../../00-constitution.md).

## Phase 0: Design (~1 week)

- JSON floor plan with rooms, walls, doors and named points → [02](../../02-world-model.md)
- Rota and handovers → [05](../../05-care-operations.md)
- Care rules → [05](../../05-care-operations.md)
- Persona skeletons for staff and residents → [06](../../06-personas-and-families.md)
- Event schema (with `source`) → [07](../../07-events-and-persistence.md)

## Phase 1: Rules-only MVP (~2–3 weeks)

- Tick engine and sim clock: pause, step, 1x, 10x, 60x, 360x → [03](../../03-simulation-engine.md)
- Rota and handovers running → [05](../../05-care-operations.md)
- Needs + utility AI → [04](../../04-agents-and-behaviour.md)
- Five core behaviour trees: morning personal care, med round, meal service, fall response, night check → [04](../../04-agents-and-behaviour.md)
- A* movement on the server → [04](../../04-agents-and-behaviour.md)
- Shapes-and-badges canvas, follow and inspector → [08](../../08-realtime-and-ui.md)
- Event log → [07](../../07-events-and-persistence.md)

## Out of scope

LLM minds (Phase 2), base-rate director and scenario cards (Phase 3), full visitor pool, off-screen family life, snapshots/replay/branching (Phase 4), sensors, equipment, air quality (not v1).

## Open questions

- Acceptance criteria for "believable" (to agree before planning).
- Phase 1 storage (in-memory vs Postgres) — see 07.
- Are any visitors in Phase 1?
- Is a minimal fall injection needed in Phase 1 to exercise the fall-response tree?

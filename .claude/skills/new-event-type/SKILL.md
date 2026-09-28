---
name: new-event-type
description: Use when adding or changing an event or input type on the event bus or in the event log (anything in shared-types that describes a state change or command).
---

# New event type

1. Read `docs/07-events-and-persistence.md` (envelope, naming, catalogue) and `docs/00-constitution.md`.
2. Define the type in `packages/shared-types` with the standard envelope, including `source` (`engine` | `director` | `user` | `llm` | `external`).
3. Payloads must be serialisable and deterministic: sim time only, ids not object references, no wall-clock timestamps.
4. Emit it from `packages/sim-engine` only (or accept it as an input); `apps/web` may render it but never create world state from it.
5. Add a test that the event appears in the log and that replay reproduces it.
6. Add the event to the catalogue in 07, then run the `pre-pr` skill.

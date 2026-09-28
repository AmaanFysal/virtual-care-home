---
name: new-behaviour-tree
description: Use when adding or changing a behaviour tree for a care procedure or routine (e.g. fall response, med round, morning personal care, meal service, night check, hoist transfer).
---

# New behaviour tree

1. Read `docs/04-agents-and-behaviour.md` (tree conventions, interrupts, movement) and the relevant section of `docs/05-care-operations.md` (the real procedure and care rules it must follow).
2. Confirm the procedure's steps, actors, required staff count and failure modes are written in 05. If not, stop and agree them with the user first.
3. Implement in `packages/sim-engine` following `.claude/rules/sim-engine.md` (seeded RNG, no wall clock, no I/O).
4. Define interrupt and resume behaviour explicitly. Emit events for each meaningful step with `source: "engine"`.
5. Add tests per `docs/11-testing.md`: unit tests for the tree, plus a golden scenario test for the correct process.
6. Update 04/05 if anything changed, then run the `pre-pr` skill.

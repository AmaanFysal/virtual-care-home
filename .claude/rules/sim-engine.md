---
paths:
  - "packages/sim-engine/**"
---

# sim-engine rules

This package must be deterministic: same seed + same inputs → same run. See docs/00-constitution.md and docs/03-simulation-engine.md.

- Never use `Math.random()`. Use the engine's seeded RNG only, passed in explicitly.
- Never read wall-clock time: no `Date.now()`, `new Date()`, `performance.now()`, `setTimeout`/`setInterval`. Use sim time.
- No I/O: no filesystem, network, database, env vars or `console` logging for behaviour. Data comes in as arguments; results go out as events.
- Iterate in a stable order (sort by id, don't rely on object/Set insertion order from external data).
- Every emitted event carries a `source` field.
- Import types from `@vch/shared-types`; never import from `apps/*`.

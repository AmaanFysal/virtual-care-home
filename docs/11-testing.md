# 11 · Testing

**Purpose:** how we prove the sim is correct and reproducible: unit tests, invariants, golden scenario tests, determinism checks, and (later) LLM evals.

> Status: partly decided (M2). Source: [plan-v2](research/plan-v2.md) (Testability), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §4.

Tooling: Vitest (`pnpm test`), TypeScript (`pnpm typecheck`).

## To be decided

- The invariant set and where it runs. Candidates: at least one staff member on the floor; no resident unchecked beyond their care-plan interval; no two-person transfer done by one; visitors never in the staff room.
- Golden scenario test format (e.g. fall at 06:40 → RN attends within 10 sim minutes, not moved before assessment, family called, incident logged).
- Determinism test: same seed + inputs → identical event log hash.
- Headless soak runs (N sim days) and what they assert.
- Guard checks for the constitution (no `Math.random` / `Date.now` in sim-engine; web doesn't import sim-engine).
- LLM evals (Phase 2) and CI provider.

## Tests so far

| File | Covers |
|---|---|
| `packages/sim-engine/test/data.test.ts` | Data validator on the real files, plus injected errors it must catch |
| `packages/sim-engine/test/engine.test.ts` | RNG reproducibility and stream independence; byte-identical logs for the same seed and inputs; different seed differs; gap-free seq and ids; every point reachable; paths use doors not walls; doorway single occupancy (targeted crossing and a 5-day run); nobody off walkable ground or faster than their speed; rota events for Tuesday; agency spawning and clean-up |


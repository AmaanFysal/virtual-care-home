# Plan: Phase 1 rules-only MVP

> Written in plan mode after `spec.md` was agreed (2026-09-28). One task = one reviewable, runnable change, committed on `phase-1-rules-mvp`.

## Approach

Build bottom-up so each milestone runs on its own: data and types first, then a headless engine you can watch in the terminal, then the server and canvas, then behaviour layered on in slices. The engine stays pure (no I/O, no wall clock); the server owns pacing, WebSockets and SQLite; the browser only draws.

Tooling defaults: hand-written A* on a 0.5 m grid (stable tie-breaks; easystar's async API fights determinism), sfc32 RNG with per-system streams, a small hand-rolled behaviour-tree runtime in TypeScript, Fastify + `@fastify/websocket`, Vite + React + `pixi.js` v8 + `@pixi/react`, Zustand.

## Tasks

| # | Task | Docs affected | Done when |
|---|------|---------------|-----------|
| M0 | Docs: spec, plan, ADR-0001 (5 s tick), ADR-0002 (SQLite); fill 02, 03, 05, 07; refresh `CLAUDE.md` | 02, 03, 05, 07, ADRs | Docs reviewed and committed |
| M1 | Data + types: floor plan, rota, 41 persona cards, relationships; shared-types for the event envelope, inputs, commands and state; Vitest data validator. **Stop for the user to review the 6 resident cards.** | 02, 06, 07 | `pnpm test` passes the validator; user has reviewed residents |
| M2 | Engine core: RNG, clock, input queue, world from data, grid + A* + movement (speeds, doorway wait), rota (staff arrive and leave via the exit door), initial state; headless CLI; determinism test | 03, 04 | `pnpm --filter @vch/sim-engine sim --seed 1 --hours 4` prints shift events; same seed gives an identical log |
| M3 | Server + canvas: Fastify/WS, SQLite log, pacer and clock commands; web draws rooms, doors, furniture and people with smooth movement, clock controls, night dimming | 07, 08 | `pnpm dev`: staff visibly arrive for shifts in the browser |
| M4a | Needs + utility, help requests and task queue, BT runtime, breaks, handovers | 04, 05 | Handovers and breaks run; floor-rule invariant holds for a day |
| M4b | Morning personal care (Raj: 2 staff + hoist), meal service, night checks and repositioning | 04, 05 | A headless day shows care, meals and checks on schedule |
| M5 | Interruptible med round with errors; `inject_fall`; day and night fall response; paramedics and hospital; golden tests | 04, 05, 11 | Golden fall tests pass |
| M6 | Visitors: daily sampling, reception sign-in, doorbell out of hours, visits and leaving | 05, 06 | 3 to 8 visitors on site mid-afternoon on seed 1 |
| M7 | Follow, inspector, badges, filtered event log panel; full invariant suite; watch-a-day acceptance test; `pre-pr`; PROGRESS | 08, 11 | Acceptance criteria in spec.md pass |

## Risks and dependencies

- Tuning needs and utility curves so the day looks right may take several passes (M4a/M4b).
- The floor rule and check intervals are strict; a thin rota (weekends, agency nights) may break them, which is realistic but must not break the Tuesday acceptance run.
- `@pixi/react` v8 compatibility with the React version; plain Pixi in a React ref is the fallback.

## Out of scope for this plan

See spec.md "Out of scope".

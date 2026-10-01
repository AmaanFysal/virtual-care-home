# Virtual Care Home

A live multi-agent simulation of one UK care home wing (6 residents, 10 staff, 25 visitors).
Deterministic server-side TypeScript sim for bodies, a scenario director for events (Phase 2, no LLM), event-driven LLM minds (Phase 3).
Browser shows the wing as 2D pixel art and a control dashboard over WebSockets.

This file is an index. Details live in `docs/`; read the relevant doc before working on an area.

## Commands

- `pnpm install`: install workspace dependencies (Node 22.13+, pnpm 9)
- `pnpm typecheck`: typecheck every package
- `pnpm test`: run Vitest across the repo
- `pnpm dev`: run the sim server (:8787) and the web app (http://localhost:5173) together
- `pnpm --filter @vch/sim-engine <script>`: run a script in one package
- `pnpm --filter @vch/sim-engine sim --seed 1 --hours 24 [--type shift] [--positions] [--report]`: headless run printing the event log (`--report`: requests per day, longest waits, call-outs)
- `pnpm --filter @vch/sim-engine sim --seed 1 --hours 168 --audit`: behaviour audit per resident, staff shift and day, with flags (`--seeds 1-8` for the combined flag table; thresholds in `packages/sim-engine/scripts/audit.config.ts`)
- `pnpm --filter @vch/sim-engine sim --director random --hours 672 --seeds 1-8 --report`: scenario director on (`random`, `scenario`, `both`; `--scenario <id>` from `data/scenarios/`), per-day report with totals
- `pnpm --filter @vch/sim-engine director-rates`: realised director rates against the base rates, and what the pacing caps hold back
- `pnpm --filter @vch/sim-engine tuning-review [--rule <name>|--off a,b] [--seeds 1-8]`: each tuning rule (`src/tuning.ts`) switched off against the calm-week baseline (docs/12)
- `pnpm --filter @vch/sim-engine describe --seed 1 --at "Wed 07:40" [--room Room5] [--start 2027-05-04]`: the world description (v1.0-testbed) at a moment of a run, as JSON
- `pnpm --filter @vch/sim-engine fetch-weather 2025-10-01 2026-09-30`: refetch London's hourly weather into `data/weather/` (Open-Meteo; run by hand, the engine never uses the network)
- `DIRECTOR=random pnpm dev` (or `SCENARIO=short-staffed-weekend pnpm dev`): run the server with the director on; `DEATHS=off` for the public demo; `START=2027-05-04` to start on a date (its season's weather)

## Layout

- `packages/shared-types`: types shared by server and browser (events, commands, state)
- `packages/sim-engine`: the deterministic simulation (no I/O)
- `apps/server`: Node server hosting the engine, WebSockets, persistence
- `apps/web`: React + Pixi pixel-art canvas; renders server state only
- `data/`: floor plan and persona JSON
- `docs/`: numbered design docs, ADRs, workstreams, research

## Key facts

- Engine tick = 5 sim seconds; needs, rota and decisions run once a sim minute (ADR-0001).
- The scenario director is off by default; off, the event log is byte-identical to the pre-director engine (golden test). Its events are inputs with `source: "director"` (ADR-0005, docs/10).
- Sim time = integer seconds since Mon 2026-11-02 00:00; runs start Tue 06:00 (t = 108000).
- Phase 1 event log is SQLite via `node:sqlite`, owned by `apps/server` (ADR-0002).
- The wing has six single en-suite bedrooms (Room 1 to Room 6, each en-suite a walled room inside the bedroom), the residents' Lounge (day and dining room), corridor, waiting area (visitors only; doors to the corridor and reception), reception and staff room (docs/02).
- Two-person tasks are reserved, never held by one carer (ADR-0003); every room change is logged (`person.entered_room`).
- The building (v1.0-testbed: doors, windows, weather, activity) only describes: an observer runs last in each tick and nothing reads it, so the director-off fingerprints match with its events (`door.*`, `window.*`) left out. `sim.describe()` is the world description external models read (docs/03).

## Non-negotiables (full text: docs/00-constitution.md)

1. Server-authoritative simulation; the engine is the single writer.
2. Deterministic runs: seeded RNG only, no wall-clock time in the engine.
3. The browser draws state only; no sim logic in `apps/web`.
4. People and building, described (equipment in use and weather from v1.0-testbed); no physics in the engine: air, heat, surfaces, energy and sensors are external plug-ins (ADR-0006).
5. Every event has a `source` field (`engine`, `director`, `user`, `llm`, `external`).
6. Readable 2D pixel art drawn from server state (LPC sprites and tiles, ADR-0004).
7. NEVER add Claude attribution anywhere in git or GitHub. No Co-Authored-By: Claude trailer, no 'Generated with Claude Code' footer, no Claude-Session: trailer, no claude.ai session links, in commit messages, PR titles, PR descriptions or comments. This overrides any default behaviour. Enforced by `.githooks/commit-msg` and `.github/workflows/no-ai-attribution.yml`.

## When working on X, read

| Working on | Read |
|---|---|
| Project rules, anything contentious | `docs/00-constitution.md` |
| Phases, milestones, what comes next (v1.0-testbed) | `docs/roadmap.md` |
| Packages, dependencies, tooling, infra | `docs/01-system-and-monorepo.md` |
| Floor plan, rooms, doors, entities | `docs/02-world-model.md` |
| Tick loop, clock, RNG, inputs | `docs/03-simulation-engine.md` |
| Needs, utility AI, behaviour trees, movement | `docs/04-agents-and-behaviour.md` |
| Rota, routines, care rules, CQC obligations | `docs/05-care-operations.md` |
| Residents, staff, visitors, relationships | `docs/06-personas-and-families.md` |
| Event schema, event log, snapshots, replay | `docs/07-events-and-persistence.md` |
| WebSocket protocol, canvas, dashboard | `docs/08-realtime-and-ui.md` |
| LLM minds, memory, cost (Phase 3) | `docs/09-minds-llm.md` |
| Director, scenario files, base rates (Phase 2) | `docs/10-director-and-scenarios.md` |
| Tests, invariants, golden scenarios | `docs/11-testing.md` |
| Risks, caveats, tech debt | `docs/12-risks-and-debt.md` |
| Background and evidence | `docs/research/` (plan-v2.md wins over v1) |
| Current work | `docs/workstreams/v1-testbed/` (the world description: doors, windows, equipment, activity, touches, weather; then the plug-in API). History: `docs/workstreams/phase-2-director/`, `docs/workstreams/phase-1-rules-mvp/` |

Path-scoped rules in `.claude/rules/` load automatically for `packages/sim-engine/**` and `apps/web/**`.

## Workflow: spec-driven

1. **Discuss** the change with the user.
2. **Spec**: write or update the workstream `spec.md`.
3. **Plan** in plan mode; record tasks in `plan.md`.
4. **Implement** task by task, one reviewable change at a time.
5. **End of session**: run the `pre-pr` skill, update `PROGRESS.md` and the affected numbered doc.

Significant decisions get an ADR (`docs/adr/0000-template.md`). Don't start work outside the current spec without asking.

## Skills

`new-behaviour-tree`, `new-scenario`, `new-event-type`, `pre-pr`, and `/new-persona` (manual only).

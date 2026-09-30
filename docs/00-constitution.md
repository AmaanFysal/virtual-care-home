# 00 · Constitution

**Purpose:** the non-negotiable rules of this project. Every other doc, spec and PR must respect them.

Changing anything here needs an ADR in `docs/adr/` and an explicit decision, not a drive-by edit.

## Non-negotiables

1. **Server-authoritative simulation.** The sim engine on the server owns all world state and is the single writer per world. Nothing else mutates the world.
2. **Deterministic runs.** A seed plus the recorded input log reproduces a run exactly.
   - All randomness comes from the engine's seeded RNG. No `Math.random()`.
   - No wall-clock time in the engine. No `Date.now()`, `new Date()`, `performance.now()` or timers inside `packages/sim-engine`. The engine only knows sim time.
   - LLM output (LLM minds, Phase 3) enters as recorded, timestamped inputs, never as a side effect. Director events (Phase 2) enter the same way, as inputs with `source: "director"`, planned from the seed, the director settings and the scenario file, so those replay a run too (ADR-0005).
3. **The browser draws state only.** `apps/web` renders what the server sends and sends typed commands back (pause, speed, inspect, inject). It contains no simulation logic and does not depend on `sim-engine`.
4. **People and building, described; physics in plug-ins.** The world is rooms, doors and windows, furniture as blockers and interaction points, people, and (from v1.0-testbed) the state of equipment in use and the outdoor weather, as part of the world description. The engine models no physical effects: air quality, heat, surfaces, energy and sensors live in external plug-in models that read the world description and send results back as recorded inputs (ADR-0006).
5. **Every event has a `source` field.** One of `engine`, `director`, `user`, `llm`, `external`. This is the extension point for future modules (adapters subscribe to events and publish inputs).
6. **Readable 2D visuals, drawn from server state.** The wing is drawn as 2D pixel art (LPC sprites and tiles, ADR-0004): a map generated from the floor plan, characters posed from what the server sends, and name tags with activity icons. Readability over realism. All art is named in a manifest and credited under its own licence, separately from the code; decor is render-only and never affects the simulation.

## Guiding principles (from the research)

- Rules for bodies, LLM for minds, director for events. The LLM picks among legal actions; it never moves agents or edits the world.
- Model the daily skeleton deterministically and the interruptions stochastically.
- Grounded in real UK care practice, but **not a clinical tool**.
- Dignity first: no stereotypes, no dementia played for laughs.

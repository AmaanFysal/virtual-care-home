---
paths:
  - "apps/web/**"
---

# web rules

The browser draws server state only. See docs/00-constitution.md and docs/08-realtime-and-ui.md.

- No simulation logic: no needs, pathfinding, behaviour trees, rota or RNG. Never import `@vch/sim-engine`.
- Render only what the server sends (positions, badges, events). Client-side interpolation between received positions is fine; inventing state is not.
- User actions are sent as typed commands from `@vch/shared-types`; the UI updates when the server confirms, not optimistically.
- Visuals are 2D pixel art (ADR-0004): LPC sprites and tiles named in `data/sprites.json` and `src/canvas/tileset.json`, the map generated from the floor plan, no hand-painted maps. Poses, facing and icons are derived from server state (posture, badges, task, movement); decor is render-only.
- Every screen <-> world conversion goes through `src/canvas/banding.ts`; pick people with `pickPerson` on their drawn figures.
- New art needs its licence and credits (`CREDITS.md`, via `tools/characters/import.mjs`); art is licensed separately from the code.

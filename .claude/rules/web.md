---
paths:
  - "apps/web/**"
---

# web rules

The browser draws server state only. See docs/00-constitution.md and docs/08-realtime-and-ui.md.

- No simulation logic: no needs, pathfinding, behaviour trees, rota or RNG. Never import `@vch/sim-engine`.
- Render only what the server sends (positions, badges, events). Client-side interpolation between received positions is fine; inventing state is not.
- User actions are sent as typed commands from `@vch/shared-types`; the UI updates when the server confirms, not optimistically.
- Keep visuals simple 2D: labelled rectangles, coloured circles with initials, badges and bubbles. No sprites or tilemaps.

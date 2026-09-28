# 08 · Realtime and UI

**Purpose:** the WebSocket protocol between server and browser, and the browser: 2D canvas plus React control dashboard.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Visualisation: simple 2D in the browser).

## To be decided

- Renderer: PixiJS (@pixi/react) vs plain HTML canvas for the first spike.
- Snapshot-on-connect and delta format; push rate (5–10 Hz); client-side interpolation between positions.
- Command message types (pause, step, speed, jump, inspect, inject) and acknowledgements.
- Phase 1 panels (clock, follow, inspector) vs later (thoughts, injector, timeline, metrics).
- Visual language: colours (staff blue, residents green, visitors orange, agency grey), badges, alert ring, night dimming.
- Dashboard state management (Zustand?) and how it stays a pure view of server state.

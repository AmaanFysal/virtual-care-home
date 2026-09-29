# 08 · Realtime and UI

**Purpose:** the WebSocket protocol between server and browser, and the browser: 2D canvas plus React control dashboard.

> Status: built (M3 canvas and clock; M7 follow, inspector and event log), 2026-09-28. Source: [plan-v2](research/plan-v2.md) (Visualisation: simple 2D in the browser). Types: `packages/shared-types/src/protocol.ts`.

## Server (`apps/server`)

- Fastify + `@fastify/websocket` on `127.0.0.1:8787` (`PORT`, `SEED`, `RUNS_DIR` env vars). `GET /api/health` returns the run id and tick; the WebSocket is `/ws`.
- One `Runner` hosts one sim. It starts **paused at 60x**. A 100 ms timer (10 Hz) adds `elapsed × speed / 5 s` ticks to an accumulator and steps the engine that many times (capped at 200 per frame), writes the new events to SQLite in one transaction, then sends a delta.
- Wall-clock time lives only here (the pacer and the run's creation time); the engine never sees it.

## Protocol

**Server → browser** (`ServerMessage`):

| Message | When | Contents |
|---|---|---|
| `snapshot` | On connect | Clock, floor plan, every person, the last 300 events |
| `delta` | Up to 10 Hz, only when something changed | Clock, **only the people whose view changed**, the new events |
| `clock` | After pause, resume or a speed change | Clock (so the UI reflects the server, not a guess) |
| `detail` | Reply to `inspect` | Person, persona card, schedule (needs, BT node and workload arrive in M4a) |
| `error` | Bad or refused command | Message |

Each person view (`PersonView`) carries their id, kind, name, initials, position, room, posture, badges and task. It also carries two display-only fields for choosing a sprite: `gender`, and `role` (staff role) for staff, agency workers and responders.

**Browser → server** (`ClientCommand`): `pause`, `resume`, `step` (only while paused; one 5 s tick), `set_speed` (1, 10, 60, 360), `inspect`, `inject_fall`. Commands are validated by `parseCommand`; unknown or malformed ones get an `error`. Every command is written to the `commands` table; `inject_fall` also becomes a logged input (docs/07).

## Browser (`apps/web`)

- **Stack:** Vite + React 19 + `pixi.js` v8 + Zustand. Pixi is driven imperatively from a React ref (`canvas/renderer.ts`) rather than through `@pixi/react`: positions change every frame, and a plain ticker avoids a React re-render per frame. This was the planned fallback.
- **State:** `store.ts` is a pure fold of server messages (`reduce`). No optimistic updates: buttons change only when the server's `clock` message arrives.
- **Canvas:**
  - Rooms are filled rectangles with names; walls are dark lines with gaps at doors; furniture is grey boxes with small labels (beds, desks, tables, chairs, WCs); `EXIT` marks the exit door.
  - People are circles with initials: staff blue, residents green, visitors orange, agency grey, off-map responders purple. Residents in bed are slightly faded; `on_floor` gets a red ring; the selected person gets a black ring; badges are small text above the head (`zz`, `meds`, `meal`, ...).
  - **Smooth movement:** each position update is interpolated from where the circle is now to the new position over the real time until the next update is expected (`5000 / speed` ms, at least 100 ms). No position is invented beyond the server's.
  - **Night:** a navy overlay (up to 45% opacity) from 22:00 to 06:00, ramping 20:00–22:00 and 06:00–07:30, with warm night lights along the corridor.
- **Clock bar:** sim date and time, Play/Pause, Step (enabled while paused), 1x/10x/60x/360x, tick counter, connection status.
- **Layout (M7):** the canvas on the left; a sidebar with the inspector above the event log. On narrow screens the sidebar goes below the canvas.
- **Selecting and following:** click a person to select them (black ring); click empty floor to clear. **Follow** zooms the camera to 2.2x and keeps them centred, easing in and out; text is rendered at high resolution so it stays sharp. `?select=<id>&follow=1` in the URL opens on someone (demos, links).
- **Inspector:** name and kind; posture, room (or "In hospital"), current task and behaviour-tree step; needs bars for residents and a workload bar for staff (green, amber over 0.5, red over 0.75); key persona facts (age, conditions, mobility, personal-care rules, check intervals, likes; role and competencies; who a visitor visits and when); today's schedule with past items struck through; for residents on the map, **inject a fall** (minor or serious); their last ten events. Refreshed from the server every second while open.
- **Event log:** the latest 200 matching events, newest first, filtered by category (All, Care, Meds, Falls, Staff, Visitors, Alerts, Movement; "All" hides movement), free-text search over the description and names, and "selected" (only the selected person). Rows are colour-coded by category; hard violations and service breaches are highlighted as alerts; non-engine sources (e.g. `user` for an injected fall) are tagged. Clicking a person chip selects them.
- Reconnects automatically with backoff if the server restarts.

## Character sprites (pixel-art milestone, branch `visuals-pixel-art`)

- **Sheets:** LPC characters, one 832 px wide sheet of 64 × 64 frames per person in `apps/web/public/sprites/characters/<personId>.png`, each with its credits file. They're made and imported by `tools/characters/` (see its README).
- **`data/sprites.json`** (written by `tools/characters/import.mjs`) gives the layout, the poses each person uses, and the workarounds:
  - Peggy's zimmer overlay on her walk and stand frames;
  - Arjun and Priya at 80% scale;
  - Raj's wheelchair block, for sitting only;
  - the hurt row's last frame for a resident on the floor after a fall.
- **Layout:** rows run north, west, south, east:
  - walk: rows 8–11 (frame 0 standing)
  - idle: rows 22–25
  - sit: rows 30–33, frame 2 (on a chair)
  - hurt: row 20
  - Raj's wheelchair: from y = 3456
- **Choosing a sheet:** `apps/web/src/sprites.ts` picks each person's own sheet. Agency staff and paramedics are picked by `role` and `gender`, because agency ids are only made up when they're booked.
- **Licence:** the art is CC-BY-SA 3.0, separate from the code. `CREDITS.md` lists every part, and the app footer links to `/CREDITS.txt`.

## To be decided

- Thoughts toggle and LLM prompt/response tab (Phase 2); scenario injector and timeline scrubber (Phase 3/4).

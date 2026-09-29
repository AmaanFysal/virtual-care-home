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

Each person view (`PersonView`) carries their id, kind, name, initials, position, room, posture, badges and task. It also carries two display-only fields for choosing a sprite: `gender`, and `role` (staff role) for staff, agency workers and responders. In deltas it may carry `via`: the turning points (path corners, doorway cells, arrivals, placements) the person passed since the previous update, in order, collected by the server from the engine's per-tick trail.

**Browser → server** (`ClientCommand`): `pause`, `resume`, `step` (only while paused; one 5 s tick), `set_speed` (1, 10, 60, 360), `inspect`, `inject_fall`. Commands are validated by `parseCommand`; unknown or malformed ones get an `error`. Every command is written to the `commands` table; `inject_fall` also becomes a logged input (docs/07).

## Browser (`apps/web`)

- **Stack:** Vite + React 19 + `pixi.js` v8 + Zustand. Pixi is driven imperatively from a React ref (`canvas/renderer.ts`) rather than through `@pixi/react`: positions change every frame, and a plain ticker avoids a React re-render per frame. This was the planned fallback.
- **State:** `store.ts` is a pure fold of server messages (`reduce`). No optimistic updates: buttons change only when the server's `clock` message arrives.
- **Canvas:** LPC pixel art (ADR-0004), described under "Pixel-art map" below. Everything drawn is derived from server state.
- **Smooth movement:** each update starts a slide from where the person is drawn now, through any turning points not yet reached, through the update's `via` points, to the new position, at a steady pace over the real time until the next update is expected (`5000 / speed` ms, at least 100 ms). Between turning points it's a straight line. The engine moves people in 5-second ticks of up to about 6 m, and one update can span several ticks, so without `via` about half of all moves were drawn cutting a corner through a wall or furniture at every speed. A test replays the server's pacing at 10x, 60x and 360x and checks every drawn segment stays on walkable floor or in a doorway.
- **Clock bar:** sim date and time, Play/Pause, Step (enabled while paused), 1x/10x/60x/360x, tick counter, connection status.
- **Layout (M7):** the canvas on the left; a sidebar with the inspector above the event log. On narrow screens the sidebar goes below the canvas.
- **Selecting and following:** click a person to select them (yellow ring); click empty floor to clear. Hovering shows a white ring and their name tag. **Follow** zooms in one step and keeps them centred, easing as they move. Drag to pan, scroll to zoom in whole steps. `?select=<id>&follow=1` opens on someone (demos, links), `?view=<roomId>&zoom=<n>` opens on a room, and `?tags=0` hides name tags (screenshots).
- **Inspector:** name and kind; posture, room (or "In hospital"), current task and behaviour-tree step; needs bars for residents and a workload bar for staff (green, amber over 0.5, red over 0.75); key persona facts (age, conditions, mobility, personal-care rules, check intervals, likes; role and competencies; who a visitor visits and when); today's schedule with past items struck through; for residents on the map, **inject a fall** (minor or serious); their last ten events. Refreshed from the server every second while open.
- **Event log:** the latest 200 matching events, newest first, filtered by category (All, Care, Meds, Falls, Staff, Visitors, Alerts, Movement; "All" hides movement), free-text search over the description and names, and "selected" (only the selected person). Rows are colour-coded by category; hard violations and service breaches are highlighted as alerts; non-engine sources (e.g. `user` for an injected fall) are tagged. Clicking a person chip selects them.
- Reconnects automatically with backoff if the server restarts.

## Character sprites

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
- **Licence:** the character art is CC-BY-SA 3.0, separate from the code. `CREDITS.md` lists every part, and the app footer links to `/CREDITS.txt`.

## Pixel-art map

- **Manifest:** `apps/web/src/canvas/tileset.json` names every tile and sprite by source rect: floors by room kind, the wall face (cut from 96 to 56 px), wall tops (a 9-slice), windows, pictures, furniture by kind, decor rules, the sofa pairing and the garden. The art is in `apps/web/public/tiles/` (see `tools/tiles/README.md`).
- **Scale:** 1 m = 32 px (one LPC tile); characters are drawn 1:1 (about 1.6 m tall). Pixel-perfect: nearest-neighbour textures, a whole number of device pixels per art pixel.
- **Banded mapping (`canvas/banding.ts`):**
  - Each horizontal wall with a room below it gets a 64 px band: an 8 px wall top and a 56 px face.
  - Everything below a band moves down by 64 px. Where a wall has rooms on both sides, the band is blended over ±0.25 m, so people cross doorways smoothly.
  - The south outer wall is a top plus a short outside face.
  - One mapping serves drawing, click-to-select, hover, Follow and the camera. Clicks pick the front-most drawn figure under the pointer (`figures.pickPerson`), so someone drawn over a wall face is still picked.
- **Map (`canvas/mapPainter.ts`):** painted once to a canvas from the floor plan:
  - grass, floors, rugs, wall faces (inside faces for rooms, light brick outside), doorways, wall tops, and the WC patches with partitions;
  - windows on outer walls (over each bed, otherwise every 3 m);
  - pictures on inner walls, clear of doors;
  - a garden in the space outside the plan, with a path from the exit.
- **Furniture and decor:** one sprite each, y-sorted with people.
  - Chairs face the nearest table or desk; armchairs face the TV; any other seat (the bedside chairs, the reading chair) faces south, towards the camera, so the sitter's face shows.
  - North-facing chairs draw their backrest over the sitter.
  - Render-only decor: bedside cabinets with lamps (which glow at night), wardrobes, rugs at the bed foot, plants in free corners, a sofa drawn in place of the two middle Lounge armchairs (their seat points are unchanged), and trees and a bench in the garden.
- **People:**
  - They face the way they move; the walk frames advance with distance walked; they stand when still.
  - Sitting uses the chair pose, or Raj's wheelchair; seated people take their seat's facing. Dozing is the chair pose with a zz icon.
  - In bed, the head from the front-facing frame is drawn on the pillow, with the sheet over it. On the floor: the hurt pose with a pulsing red ring.
  - Standing still in a WC area (restocking, helping), they face the toilet.
  - Each has a soft shadow; the selected person has a yellow ring, the hovered person a white one.
- **Name tags** (header toggle): initials on the kind colour (the legend), with an icon: meal, drink, meds, care, asleep, notes, chatting, visiting, break or fall. The icon comes from badges, posture and task. Overlapping tags are nudged apart; with tags off, the selected and hovered person still show theirs.
- **Night:** a navy overlay (up to 55%) from 22:00 to 06:00, ramping 20:00–22:00 and 06:00–07:30, with warm lights along the corridor and at the bedside lamps.

## To be decided

- Thoughts toggle and LLM prompt/response tab (Phase 2); scenario injector and timeline scrubber (Phase 3/4).

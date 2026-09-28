# 08 · Realtime and UI

**Purpose:** the WebSocket protocol between server and browser, and the browser: 2D canvas plus React control dashboard.

> Status: protocol, canvas and clock controls built (M3, 2026-09-28). Follow, inspector, badges and the event log panel come in M7. Source: [plan-v2](research/plan-v2.md) (Visualisation: simple 2D in the browser). Types: `packages/shared-types/src/protocol.ts`.

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

**Browser → server** (`ClientCommand`): `pause`, `resume`, `step` (only while paused; one 5 s tick), `set_speed` (1, 10, 60, 360), `inspect`, `inject_fall`. Commands are validated by `parseCommand`; unknown or malformed ones get an `error`. Every command is written to the `commands` table; `inject_fall` also becomes a logged input (docs/07).

## Browser (`apps/web`)

- **Stack:** Vite + React 19 + `pixi.js` v8 + Zustand. Pixi is driven imperatively from a React ref (`canvas/renderer.ts`) rather than through `@pixi/react`: positions change every frame, and a plain ticker avoids a React re-render per frame. This was the planned fallback.
- **State:** `store.ts` is a pure fold of server messages (`reduce`). No optimistic updates: buttons change only when the server's `clock` message arrives.
- **Canvas:**
  - Rooms are filled rectangles with names; walls are dark lines with gaps at doors; furniture is grey boxes with small labels (beds, desks, tables, chairs, WCs); `EXIT` marks the exit door.
  - People are circles with initials: staff blue, residents green, visitors orange, agency grey, off-map responders purple. Residents in bed are slightly faded; `on_floor` gets a red ring; the selected person gets a black ring; badges are small text above the head (`zz`, `meds`, `meal`, ...).
  - **Smooth movement:** each position update is interpolated from where the circle is now to the new position over the real time until the next update is expected (`5000 / speed` ms, at least 100 ms). No position is invented beyond the server's.
  - **Night:** a navy overlay (up to 45% opacity) from 22:00 to 06:00, ramping 20:00–22:00 and 06:00–07:30, with warm night lights along the corridor.
- **Clock bar:** sim date and time, Play/Pause, Step (enabled while paused), 1x/10x/60x/360x, tick counter, connection status. Clicking a person selects them (footer shows name, posture and room); the full inspector is M7.
- Reconnects automatically with backoff if the server restarts.

## To be decided (M7)

- Follow camera behaviour (pan vs. keep centred), inspector layout, event log filters, thoughts toggle (Phase 2).

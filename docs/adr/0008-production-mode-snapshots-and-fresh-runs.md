# ADR 0008: Production mode, snapshots, and a fresh run when the code changes

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Amaan (project owner)
- **Affected docs:** docs/07-events-and-persistence.md, docs/08-realtime-and-ui.md, docs/11-testing.md, docs/13-hosting.md, CLAUDE.md

## Context

The wing is going public: the web app on Vercel and the sim server on an always-on host (Fly.io, docs/13). Until now the server was a local tool:
- it started paused;
- every browser could run the clock and trigger events;
- it wrote an unbounded log;
- it lost the world on restart.

A public demo has to keep running through restarts and deploys, keep its disk bounded, and let only the owner control it. docs/07 placed snapshots and restore in Phase 4.

The repo will also be public, so running it locally must stay exactly as it is, with every control.

## Decision

**Production mode only from the host.** `VCH_MODE=production` (set in `fly.toml`, with `ADMIN_TOKEN` and `ALLOWED_ORIGINS` as Fly secrets) switches on:
- read-only viewers;
- an admin token for the clock and events;
- running at 10x from the start;
- snapshots and resume;
- bounded storage;
- connection limits.

Without it, the server behaves as before.

**Snapshots from the engine, written by the server.**
- `sim.snapshot()` returns the world between ticks, with each random stream replaced by its state; `restoreSim()` carries on from it. Both are pure (constitution rules 1 and 2).
- The server serialises snapshots with v8's structured clone and gzip, writes them atomically to the run's folder every few minutes and on SIGTERM, and keeps the newest three.
- A test restores at several ticks and requires the rest of the run to be byte-identical to an uninterrupted one.

**Resume only the same build; otherwise a fresh run the next morning** (project owner).
- On start, the server resumes the latest snapshot if the engine build, the data version, the director settings and the seed all match. It cuts the run's log back to the snapshot's tick.
- If anything differs, it starts a fresh run at 06:00 on the day after the snapshot's date, so the clock carries on. The engine build is a hash of the engine's and shared types' source.

**Roles in the protocol.**
- Each connection is a viewer or an admin. The snapshot message says which, and the browser shows controls only to admins.
- `auth` carries the token, compared in constant time. The token is never in the web app's code, and the admin page keeps it in `sessionStorage`.

**Bounded storage.**
- Events older than `EVENT_RETENTION_DAYS` (30 sim days) are pruned, with SQLite's incremental vacuum.
- Inputs and admin commands are kept.
- Read-only commands (`inspect`) are no longer logged.
- Old run folders beyond `KEEP_RUNS` are removed.

## Consequences

- **Easier:**
  - the demo survives restarts and host maintenance with no visible jump;
  - each run stays exactly replayable (seed + data + director settings + inputs; or the snapshot + inputs after it);
  - snapshots also make a future "branch from here" (Phase 4) cheaper.
- **Harder:**
  - any engine or data change ends the public run on its next deploy (accepted: it's honest, and the clock carries on);
  - the engine must keep all of its state in `World` (or derive it from data); state anywhere else would break restore. The snapshot test catches that.
- **Replay after pruning:** the log keeps recent events only, but inputs are kept, so a run is still rebuilt from its seed. The prune window is a viewing convenience, not the record.
- **Follow-up:** docs/07 now describes run folders and snapshots; docs/08 roles and limits; docs/13 deployment.

## Alternatives considered

- **Resume by replaying the run from the start:** simple, but slower every day it runs (about 1.6 s of replay per real day at 10x, so minutes after a few months). Snapshots make it instant.
- **Carry the world across code changes** when the snapshot's format matches: continuity, but an unversioned change to the world's shape could break it quietly. The project owner chose fresh runs.
- **Admin via a separate HTTP API with sessions:** more moving parts than a token over the existing socket for a single owner.
- **Controls hidden by a build flag:** the browser would decide; the server must, since viewers can send anything.

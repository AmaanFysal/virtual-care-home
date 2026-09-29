# ADR 0002: SQLite for the Phase 1 event log

- **Status:** Accepted
- **Date:** 2026-09-28
- **Deciders:** Amaan Fysal
- **Affected docs:** docs/07-events-and-persistence.md, docs/01-system-and-monorepo.md

## Context

The plan's final stack is Postgres + pgvector. Phase 1 has no memories or embeddings; it needs only an append-only log of events and inputs per run. Requiring Postgres from milestone 1 means Docker or a local server just to run the sim.

## Decision

We will use SQLite through Node's built-in `node:sqlite` module for Phase 1, with one database file per run under `runs/` (git-ignored). It holds two append-only tables: `events` and `inputs`, plus a `run` metadata row (seed, start time, data version). Node >= 22.13 is required (`node:sqlite` is available without a flag from 22.13). If `node:sqlite` causes problems we will switch to `better-sqlite3`, which has the same synchronous shape.

Only `apps/server` touches SQLite. The engine emits events and knows nothing about storage.

## Consequences

- `pnpm dev` needs no database service.
- Moving to Postgres in Phase 2 means porting two tables and a small writer in `apps/server`.
- SQLite writes are synchronous; the server batches each tick's events in one transaction to keep 360x smooth.

## Alternatives considered

- **Postgres from day one:** matches the final stack, but needs Docker or a local server from M1 for no Phase 1 benefit.
- **JSONL files:** zero dependencies, but filtering and querying the log (for the UI panel and tests) is clumsier.

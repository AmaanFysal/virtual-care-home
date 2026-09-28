# 01 · System and monorepo

**Purpose:** the overall architecture, the packages, their boundaries and dependency direction, and the tooling.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Backend architecture, Final stack), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §4.

Current packages: `shared-types` ← `sim-engine` ← `server`; `web` depends on `shared-types` only.

## Decided (Phase 1)

- Node >= 22.13 (for `node:sqlite`), pnpm 9. Packages are consumed as TypeScript source; no build step for `shared-types` or `sim-engine`.
- Server: Fastify + `@fastify/websocket`. Web: Vite + React + `pixi.js` v8 (`@pixi/react`) + Zustand.
- Storage: SQLite via `node:sqlite`, only in `apps/server` ([ADR-0002](adr/0002-sqlite-event-log-phase-1.md)).
- Local dev: a single `pnpm dev` runs the server and the web app; no database service needed.

## To be decided

- When to add the `persona-gen` package listed in the plan's stack (Phase 2 at the earliest; Phase 1 personas are hand-written).
- LLM job queue: in-process for Phase 2 vs BullMQ + Redis.
- Deploy target and timing (Docker, then ECS Fargate + RDS + S3).

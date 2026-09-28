# 01 · System and monorepo

**Purpose:** the overall architecture, the packages, their boundaries and dependency direction, and the tooling.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Backend architecture, Final stack), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §4.

Current packages: `shared-types` ← `sim-engine` ← `server`; `web` depends on `shared-types` only.

## To be decided

- When to add the `persona-gen` package listed in the plan's stack (not scaffolded yet).
- Build approach: packages consumed as TS source (current) or built to `dist` (tsc / tsup).
- WebSocket library: `ws` or Socket.IO. REST: Fastify from day one or later.
- LLM job queue: in-process for the MVP vs BullMQ + Redis.
- Storage for Phase 1: Postgres from the start, or in-memory / file-based first.
- Local dev orchestration (single `pnpm dev`? Docker Compose for Postgres?).
- Deploy target and timing (Docker, then ECS Fargate + RDS + S3).

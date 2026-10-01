# Plan: hosting

Approved 2026-10-01. One PR, branch `hosting`.

| # | Task | Where | Done |
|---|---|---|---|
| 1 | Engine snapshots: RNG state, `sim.snapshot()`, `restoreSim()`, a byte-identical restore test | `packages/sim-engine/src/{rng,sim}.ts`, `test/snapshot.test.ts` | ✓ |
| 2 | Server settings from the environment; dev by default | `apps/server/src/config.ts` | ✓ |
| 3 | Roles and auth in the protocol; viewers may only inspect | `shared-types/src/protocol.ts`, `apps/server/src/runner.ts`, `index.ts` | ✓ |
| 4 | Snapshots on disk, resume or a fresh run, pruning of the log and old runs | `apps/server/src/{persist,eventlog}.ts` | ✓ |
| 5 | Origins, connection and message limits, auth lockout, slow viewers | `apps/server/src/limits.ts`, `runner.ts` | ✓ |
| 6 | Web: `VITE_SIM_URL`, controls for admins, the `#/admin` page | `apps/web/src/{net,store,App}.ts(x)`, `components/AdminPage.tsx`, `vite.config.ts` | ✓ |
| 7 | Dockerfile, `.dockerignore`, `fly.toml`, `apps/web/vercel.json` | repo root | ✓ |
| 8 | docs/13, ADR-0008, docs/07, 08, 11, 12, CLAUDE.md, roadmap, a README Hosting section | `docs/`, `README.md` | ✓ |
| 9 | Secrets and personal-data audit of the repo and its history | `PROGRESS.md` | ✓ |

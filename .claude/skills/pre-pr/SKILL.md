---
name: pre-pr
description: Use when finishing a work session, before committing, or before opening a PR. Runs typecheck and tests, checks constitution invariants, and updates the affected numbered doc and PROGRESS.md.
---

# Pre-PR checklist

1. Run `pnpm typecheck` and `pnpm test` from the repo root. Fix failures; report any you cannot fix, with output.
2. Check the constitution (`docs/00-constitution.md`) on the diff:
   - `grep -rnE "Math\.random|Date\.now|new Date\(|performance\.now|setTimeout|setInterval" packages/sim-engine/src` returns nothing.
   - No `node:fs`, `node:net`, `process.env` or other I/O in `packages/sim-engine/src`.
   - `apps/web` does not import `@vch/sim-engine` and contains no simulation logic.
   - Every new event type has a `source` field.
   - No sensors, equipment or air-quality features have crept in.
3. If sim invariants exist (`docs/11-testing.md`), confirm their tests ran and passed.
4. Update the numbered doc(s) in `docs/` affected by this change so they match the code. Record significant decisions as an ADR from `docs/adr/0000-template.md`.
5. Update the active workstream's `PROGRESS.md` (done, in progress, next, blockers, session log row).
6. Summarise for the user: what changed, checks run and results, docs updated.

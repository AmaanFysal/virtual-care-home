# Virtual Care Home

A live multi-agent simulation of one UK care home wing: a deterministic TypeScript simulation of residents, staff and visitors, drawn as simple 2D shapes in the browser, with LLM-driven minds and a scenario director to come.

> Status: Phase 1 (rules-only MVP) built. Run `pnpm dev` and open http://localhost:5173.

## Requirements

- Node.js 22.13+
- pnpm 9

## Getting started

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm dev        # sim server on :8787 and the browser app on http://localhost:5173
pnpm --filter @vch/sim-engine sim --seed 1 --hours 168 --report   # headless week with a report
```

## Repository

| Path | What |
|---|---|
| `packages/shared-types` | Types shared by server and browser |
| `packages/sim-engine` | Deterministic simulation engine |
| `apps/server` | Node server: hosts the engine, WebSockets, persistence |
| `apps/web` | Browser: 2D canvas and control dashboard |
| `data/` | Floor plan and persona data |
| `docs/` | Design docs (start with `00-constitution.md`), ADRs, workstreams, research |

## Roadmap

0. Design · 1. Rules-only MVP · 2. Minds (LLM) · 3. Director and scenarios · 4. Living families · 5. Optional extras.
See `docs/research/plan-v2.md`.

Not a clinical tool. All personas are synthetic.

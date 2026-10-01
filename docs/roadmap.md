# Roadmap

**Purpose:** the order of the project's phases and milestones. Each phase has a workstream in `docs/workstreams/`; the design for each is in the numbered docs.

| Phase or milestone | What | Status |
|---|---|---|
| Phase 1 · Rules MVP | The wing, its people and its routines: deterministic engine, rota, care, meds, falls, visitors, the Lounge, pixel-art view (`workstreams/phase-1-rules-mvp/`) | Done |
| Phase 2 · Scenario director | Unplanned events at realistic rates and scripted scenarios, without an LLM (docs/10, ADR-0005, `workstreams/phase-2-director/`): (a) core, falls, sick calls; (b) outbreaks; (c) illness, hospital, end of life, admissions; (d) visitors' missed weeks and celebrations; (e) tuning-debt review | Done (PRs #7 to #11, 2026-09-30) |
| **v1.0-testbed** | The care home as a test bed, before any environmental model (below) | World description done (`workstreams/v1-testbed/`): PR 1 (people, doors, windows, weather, #15) and PR 2 (equipment, touches, #17) merged. The plug-in API is deferred (project owner, 2026-10-01): the pipeline uses files |
| External models | Models that read the wing's activity data, each in its own repo; none are built in this repo | After v1.0-testbed, reading the activity data as files (the plug-in API is deferred) |
| Phase 3 · LLM minds | Event-driven minds for residents, staff and visitors (docs/09) | After v1.0-testbed (project owner, 2026-09-30); parked until then |
| Phase 4 | Branching and timeline scrubbing; richer visitors (moods, conflicts) | Later |

## Scope: activity data, not perfect care (project owner, 2026-10-01)

The wing exists to produce data: an ordinary UK care home day, with day-to-day randomness, everything logged and sent out for external models, which live in their own repos. Care rules matter only where they change who is where, doing what. The full scenario audit, its fixes and the 15 tuning rules were removed on 2026-10-01 (docs/12); occasional late turns and missed look-ins are accepted.

## v1.0-testbed (project owner, 2026-09-30)

The next milestone after the scenario director. It turns the wing into a test bed that external models can plug into. The environmental models come after it. Tagged `v1.0-testbed` when done.

- **A world description, published every step:**
  - each person's activity type and intensity (for example sleeping, sitting, walking, personal care, hoisting);
  - touches on objects (who touched what, and when);
  - doors and windows, with open and closed states and the rules that open and close them;
  - equipment in use, such as showers, TVs, kettles, lights and heating;
  - the outdoor weather.
- **A plug-in API** so external models can connect, read the world description, react to it and send results back. **Deferred (project owner, 2026-10-01):** the pipeline uses files, so external models read the activity data from files rather than running in lockstep with the engine. The design below stays as the sketch if it's picked up again:
  - lockstep with the engine (the sim waits for plug-ins each step when asked to), so runs stay deterministic and replayable;
  - recording of everything plug-ins send, as inputs with `source: "external"` (constitution rule 5), so a run with plug-ins replays exactly.
- **Constitution:** ADR-0006 amends rule 4 so the world may describe equipment in use and the outdoor weather; the physical effects stay in external plug-in models, never in the engine.

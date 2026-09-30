# Roadmap

**Purpose:** the order of the project's phases and milestones. Each phase has a workstream in `docs/workstreams/`; the design for each is in the numbered docs.

| Phase or milestone | What | Status |
|---|---|---|
| Phase 1 · Rules MVP | The wing, its people and its routines: deterministic engine, rota, care, meds, falls, visitors, the Lounge, pixel-art view (`workstreams/phase-1-rules-mvp/`) | Done |
| Phase 2 · Scenario director | Unplanned events at realistic rates and scripted scenarios, without an LLM (docs/10, ADR-0005, `workstreams/phase-2-director/`): (a) core, falls, sick calls; (b) outbreaks; (c) illness, hospital, end of life, admissions; (d) visitors' missed weeks and celebrations; (e) tuning-debt review | (a) to (c) merged; (d) and (e) in progress |
| **v1.0-testbed** | The care home as a test bed, before any environmental model (below) | Next, after Phase 2 (e) |
| Environmental models | External models as plug-ins: air (replacing the airborne proxy in docs/10), heat, surfaces, energy; steriliser experiments on the air model | After v1.0-testbed, built outside the engine against the plug-in API |
| Phase 3 · LLM minds | Event-driven minds for residents, staff and visitors (docs/09) | After v1.0-testbed (project owner, 2026-09-30); parked until then |
| Phase 4 | Branching and timeline scrubbing; richer visitors (moods, conflicts) | Later |

## v1.0-testbed (project owner, 2026-09-30)

The next milestone after the scenario director. It turns the wing into a test bed that external models can plug into. The environmental models come after it. Tagged `v1.0-testbed` when done.

- **A world description, published every step:**
  - each person's activity type and intensity (for example sleeping, sitting, walking, personal care, hoisting);
  - touches on objects (who touched what, and when);
  - doors and windows, with open and closed states and the rules that open and close them;
  - equipment in use, such as showers, TVs, kettles, lights and heating;
  - the outdoor weather.
- **A plug-in API** so external models (air, heat, surfaces, energy) can connect, read the world description, react to it and send results back:
  - lockstep with the engine (the sim waits for plug-ins each step when asked to), so runs stay deterministic and replayable;
  - recording of everything plug-ins send, as inputs with `source: "external"` (constitution rule 5), so a run with plug-ins replays exactly.
- **Constitution:** ADR-0006 amends rule 4 so the world may describe equipment in use and the outdoor weather; the physical effects (air, heat, surfaces, energy) stay in external plug-in models, never in the engine.

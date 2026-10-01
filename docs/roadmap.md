# Roadmap

**Purpose:** the order of the project's phases and milestones. Each phase has a workstream in `docs/workstreams/`; the design for each is in the numbered docs.

| Phase or milestone | What | Status |
|---|---|---|
| Phase 1 · Rules MVP | The wing, its people and its routines: deterministic engine, rota, care, meds, falls, visitors, the Lounge, pixel-art view (`workstreams/phase-1-rules-mvp/`) | Done |
| Phase 2 · Scenario director | Unplanned events at realistic rates and scripted scenarios, without an LLM (docs/10, ADR-0005, `workstreams/phase-2-director/`): (a) core, falls, sick calls; (b) outbreaks; (c) illness, hospital, end of life, admissions; (d) visitors' missed weeks and celebrations; (e) tuning-debt review | Done (PRs #7 to #11, 2026-09-30) |
| **Full scenario audit** | A check of the whole sim before the test bed is built on it (below; `workstreams/sim-audit/`, ADR-0007) | Paused after PR B (2026-10-01) for v1.0-testbed; resumes with PR C after it. Report done (45 gaps), fixes in PRs B to F |
| **v1.0-testbed** | The care home as a test bed, before any environmental model (below) | In progress (brought forward by the project owner, 2026-10-01; `workstreams/v1-testbed/`): PR 1 (people, doors, windows, weather) in review; PR 2 (equipment, touches) next; then the plug-in API's design discussion |
| Care routine review | The audit regressions left by the tuning review (docs/12): late first food (Arthur, Peggy, Win), Arthur's hunger, Raj's toileting during meals and morning care. A shared daily planner, or pre-meal toileting rounds and a review of the morning routine; measured with the audit as well as the service targets | After v1.0-testbed |
| Environmental models | External models as plug-ins: air (replacing the airborne proxy in docs/10), heat, surfaces, energy; steriliser experiments on the air model | After v1.0-testbed, built outside the engine against the plug-in API |
| Phase 3 · LLM minds | Event-driven minds for residents, staff and visitors (docs/09) | After v1.0-testbed (project owner, 2026-09-30); parked until then |
| Phase 4 | Branching and timeline scrubbing; richer visitors (moods, conflicts) | Later |

## Full scenario audit (project owner, 2026-09-30)

Before the v1.0-testbed design discussion: an audit of the whole simulation, now that the director can make any combination of events happen. It **reports gaps first**; fixes are agreed and made afterwards.

**Report done** (2026-10-01, `workstreams/sim-audit/report.md`): 45 gaps, 19 unsafe, each with a scenario. The project owner's decisions (ADR-0007) and the fix order, one reviewed PR at a time (A: tooling and report; B: engine bugs; C: staffing escalation; D: card items; E: visiting, outbreaks, end of life and admissions; F: the rest, then the safety monitor wired in), are in `workstreams/sim-audit/spec.md` and `plan.md`.

- **Feature interaction review:** every pair of director features that can overlap (falls, sick calls and no-shows, outbreaks and isolation, illness and hospital, end of life and death, admissions, visitors' missed weeks, celebrations, night cover, the tuning rules), checked for rules that conflict or assume the other isn't happening.
- **New every-tick invariants:** hard rules checked on every tick for states that should never happen (for example staff holding a task that no longer exists, a resident in two places, work for someone who has died or left), added to the existing checks in docs/11.
- **Random stress testing:** many seeds and long runs with the random director at raised rates and forced overlaps, watching the hard invariants and the audit.
- **Realism review:** the behaviour and the numbers (rates, timings, staffing, family life) against care-home practice and the sources, noting where the sim is unrealistic.

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

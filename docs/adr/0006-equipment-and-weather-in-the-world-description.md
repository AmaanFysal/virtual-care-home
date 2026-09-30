# ADR 0006: Equipment and weather in the world description, physics in plug-ins

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Amaan (project owner)
- **Affected docs:** docs/00-constitution.md (rule 4), CLAUDE.md, docs/roadmap.md, docs/02-world-model.md, docs/10-director-and-scenarios.md

## Context

Constitution rule 4 says: "v1 is people and building only. No sensors, equipment or air quality in v1." It kept Phase 1 small, and kept the engine from growing half-built physics.

The next milestone, v1.0-testbed (docs/roadmap.md), turns the wing into a test bed. External models (air, heat, surfaces, energy) will plug in, read a world description published every step, and send their results back. To be useful to them, the world description needs more than people and rooms:

- each person's activity type and intensity, and their touches on objects;
- doors and windows, with open and closed states and the rules that change them;
- equipment in use: showers, TVs, kettles, lights, heating;
- the outdoor weather.

Equipment and weather are "equipment" in the rule's words, so the rule as written forbids the milestone. What the rule was protecting against is the engine modelling physics (air quality, heat and the like) itself, which would make it slow, hard to validate and tied to one model. That concern still stands.

The engine already has one physics-shaped term: the airborne infection proxy (docs/10). It reads only who is in which room, and it's documented as a stand-in that the air model replaces.

## Decision

We will amend rule 4. The world may **describe** equipment in use and the outdoor weather; the **physical effects** stay outside the engine.

- **In the engine (the world description):** people and their activities, rooms, doors and windows and their states, furniture, the objects people touch, which equipment is in use and how (a shower running, a kettle on, lights and heating on or off, set points), and the outdoor weather. These are states and events the rules can read and change, all deterministic and replayable.
- **Never in the engine:** air quality, heat flow and temperatures, surface contamination, energy use, sensors, or any other physical model. These live in external plug-in models, which read the world description and send results back as recorded inputs with `source: "external"` (rule 5), so a run with plug-ins replays exactly.
- **The airborne proxy** stays as it is (a co-location rule, not an air model) until an air plug-in replaces it in the same slot.

Rule 4 now reads:

> **People and building, described; physics in plug-ins.** The world is rooms, doors and windows, furniture as blockers and interaction points, people, and (from v1.0-testbed) the state of equipment in use and the outdoor weather, as part of the world description. The engine models no physical effects: air quality, heat, surfaces, energy and sensors live in external plug-in models that read the world description and send results back as recorded inputs (ADR-0006).

## Consequences

- **Easier:** the test bed can publish what external models need without breaking the constitution. Each model can be swapped, compared or run against the same recorded day.
- **Harder:** the world description becomes a contract. Changing it affects every plug-in, so it needs a version and a schema (part of the milestone's work).
- **Follow-up:** the v1.0-testbed spec defines the world description, the plug-in API, lockstep and recording. docs/02 gains equipment, windows and weather when they're built. CLAUDE.md's summary of rule 4 changes to match.
- **Unchanged:** determinism (rule 2), the engine as the single writer (rule 1: plug-ins send inputs, they don't write the world), and `source` on every event (rule 5).

## Alternatives considered

- **Keep rule 4 and publish only people and rooms:** plug-ins would have to guess at equipment and weather, and every model would guess differently.
- **Build the physics into the engine:** one air or heat model would be baked in, slowing every run and blocking the comparisons the test bed exists for.
- **Let plug-ins write the world directly:** breaks rule 1 and replay; results must come back as recorded inputs.

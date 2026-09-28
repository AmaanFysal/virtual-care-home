# 04 · Agents and behaviour

**Purpose:** the body layer: needs and utility AI, behaviour trees for care procedures, simple state machines, and movement.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Agent architecture), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §2.

## To be decided

- Needs list and decay curves (hunger, thirst, toileting, fatigue, pain, social, comfort; staff workload and stress).
- Utility AI tuning and anti-dithering (hysteresis, commitment time).
- Behaviour tree implementation: hand-rolled or a library; how trees are authored and tested.
- Interrupt and resume semantics (a med round interrupted by a fall; error chance rising with interruptions).
- Staff task allocation: simple task queue vs GOAP / HTN (optional in the plan).
- Multi-agent tasks (two-person hoist transfer) and how two agents coordinate.
- Movement: A* library (easystar.js / pathfinding.js), speeds (frail 0.3–0.5 m/s, staff ~1.2 m/s), doorway wait rule, local avoidance.
- The first five trees: morning personal care, med round, meal service, fall response, night check.

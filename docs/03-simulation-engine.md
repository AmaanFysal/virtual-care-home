# 03 · Simulation engine

**Purpose:** the tick loop, sim clock, system order, seeded RNG and input handling inside `packages/sim-engine`.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Backend architecture), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §4.

## To be decided

- Tick size: 1 sim minute per tick (as planned), or finer ticks / sub-steps for smooth movement.
- Clock speeds (pause, step, 1x, 10x, 60x, 360x, jump to time) and how "1x" maps to real time on the server.
- System order per tick. Proposed: rota → director → needs decay → decision (utility) → behaviour trees → movement → interactions → mind triggers.
- RNG algorithm and whether each system gets its own derived stream.
- Input queue design (AI Town style monotonically increasing input number, stamped with sim time).
- Sim calendar: start date and day of week (rota and visiting depend on it).
- Whether invariants are checked every tick at runtime or only in tests.
- Performance budget: what must a tick cost to sustain 360x?

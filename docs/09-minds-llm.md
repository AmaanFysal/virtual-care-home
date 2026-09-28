# 09 · Minds (LLM) — Phase 2

**Purpose:** the mind layer: memory stream, dementia-aware recall, LLM triggers, dialogue, plans and reflections, cost controls.

> Status: stub, **Phase 2**. Source: [plan-v2](research/plan-v2.md) (Mind layer, Dementia-aware memory, Cost and latency), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §2.

## To be decided

- Memory stream scoring (importance, recency, relevance) and storage (pgvector or simpler first).
- Dementia-aware recall parameters (recent retention, time anchor at dusk, misidentification rate, weak consolidation).
- Exact LLM triggers and importance threshold.
- Structured output schema (action id, utterance, emotion delta, memory importance) and how "legal actions" are offered.
- Model choice per tier. Verify current model names and prices when Phase 2 starts.
- Tiered fidelity (A/B/C), prompt caching layout, template barks, budget governor.
- Recorded / mock provider for deterministic runs and CI.
- LLM eval rubric (in character, dementia-consistent, no clinical nonsense, respectful).

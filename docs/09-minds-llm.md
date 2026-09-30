# 09 · Minds (LLM) — Phase 3

**Purpose:** the mind layer: memory stream, dementia-aware recall, LLM triggers, dialogue, plans and reflections, cost controls.

> Status: **Phase 3** (moved after the scenario director on 2026-09-30, ADR-0005). A design was proposed on 2026-09-29 and parked; it's summarised below to pick up when Phase 3 starts. Re-check model names and prices then. Source: [plan-v2](research/plan-v2.md) (Mind layer, Dementia-aware memory, Cost and latency), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §2.

## Parked design (2026-09-29)

- **Keeping the non-negotiables.**
  - A pure `packages/minds` package holds triggers, prompts, memory scoring, dementia recall, schemas and templates. All I/O stays in `apps/server/src/minds`.
  - LLM output enters only as inputs with `source: "llm"`: utterances, thoughts, plans, reflections, handover notes, life updates. Nothing that moves people or changes tasks.
  - Every call is keyed by a hash of model, schema and prompt, and stored. Replays use the recorded inputs; tests use mock or recorded providers and never call the API.
  - Keys live in `.env`.
- **Models (as checked on 2026-09-29):**
  - Claude Haiku 4.5 (`claude-haiku-4-5-20251001`, $1/$5 per MTok, minimum cacheable prefix 4,096 tokens) for everyday talk;
  - Claude Sonnet 5.5 (`claude-sonnet-5-5`, $2/$10) for key scenes, plans and reflections;
  - the Message Batches API (50% off) for overnight work;
  - the Anthropic API directly, not Bedrock.
- **Memory:**
  - observations derived deterministically from events, with importance from a rules table;
  - retrieval by recency, importance and relevance (Park et al.);
  - local embeddings (bge-small via transformers.js), with Voyage as an option;
  - SQLite, not Postgres, until multi-week branching needs more.
- **Dementia-aware recall** from each card's `memory_profile`:
  - recent memories fade (retention hours);
  - older, era-anchored memories surface at dusk;
  - occasional misidentified faces, from a deterministic hash;
  - full memory for Arthur.
- **Tiers:**
  - A: the followed person and key scenes, on Sonnet;
  - B: others on site, on Haiku;
  - C: off-site family and off-shift staff, as a nightly batch;
  - templates for routine care talk.

  One call writes a whole short exchange.
- **Cost controls:**
  - a shared cached world prefix of at least 4,096 tokens;
  - structured outputs;
  - a sim-day budget ($3 default) that demotes Tier B to templates at 80%.

  Estimated at about $1.25 per sim day.
- **UI:** speech bubbles, a thoughts toggle, inspector tabs (memories, plan, last prompt and response), a cost meter.
- **Handovers:** LLM notes per resident, from what that carer knows, so information can be lost.
- **Dignity:** a style guide in the prefix, banned-pattern checks, and an offline eval rubric scored by a judge model.
- **Sub-milestones:**
  - (a) conversations and "what are you thinking?";
  - (b) memory and reflection;
  - (c) plans choosing among legal actions;
  - (d) handovers and off-screen family.
- **Open decisions:** local or Voyage embeddings; the budget; whether live API calls are allowed during development; the exact LLM triggers and importance threshold; the structured output schema (action id, utterance, emotion delta, memory importance) and how legal actions are offered.

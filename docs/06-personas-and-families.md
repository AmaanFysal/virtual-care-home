# 06 · Personas and families

**Purpose:** the cast (10 staff, 6 residents, 25 visitors), persona and relationship schemas, the generation pipeline, and versioning.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Personas and families), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §5.

Data lives in `data/personas/` (`staff.json`, `residents.json`, `visitors.json`, `relationships.json`).

## To be decided

- Final schemas: v1's richer resident example vs v2's trimmed one. Which fields does Phase 1 actually need?
- ID convention (`res_`, `stf_`, `vis_`) and how IDs are referenced elsewhere (rooms, rota, relationships).
- How many of the 25 visitors exist in Phase 1.
- Generation pipeline timing: hand-written for Phase 1, `persona-gen` (skeleton → LLM narrative fill → validators) later?
- Validator list (date arithmetic, symmetric relationships, care needs vs conditions, name uniqueness).
- Versioning and freezing persona sets; how a run references a version.
- Human review process for stereotypes and dignity.

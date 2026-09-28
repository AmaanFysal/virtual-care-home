# 07 · Events and persistence

**Purpose:** the event and input schema, the internal event bus, the append-only event log, snapshots and replay.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Backend architecture, Built to extend later), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §4.

Fixed: every event carries `source`: `engine` | `director` | `user` | `llm` | `external` (see [00](00-constitution.md)).

## To be decided

- Event envelope: id, sequence number, sim time, type, actors, payload, source. Anything else (schema version, causation id)?
- Inputs vs events: are commands and LLM results "inputs" with a separate log?
- Event type naming convention (`resident.fell`, `staff.shift_started`, ...) and the initial catalogue.
- Phase 1 storage: in-memory + file, SQLite, or Postgres.
- Snapshot cadence and format; restore and branch-from-here semantics.
- Replay guarantees and how recorded LLM outputs are keyed (input hash).
- Schema evolution for old logs.

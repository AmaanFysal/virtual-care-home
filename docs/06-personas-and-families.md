# 06 · Personas and families

**Purpose:** the cast (10 staff, 6 residents, 25 visitors), persona and relationship schemas, the generation pipeline, and versioning.

> Status: Phase 1 cast written (2026-09-28), pending the user's review of the six resident cards. Source: [plan-v2](research/plan-v2.md) (Personas and families), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §5. Types: `packages/shared-types/src/data.ts`.

Data lives in `data/personas/` (`staff.json`, `residents.json`, `visitors.json`, `relationships.json`). The rota is `data/rota.json` (see [05](05-care-operations.md)).

## ID convention

| Prefix | Who | Where defined |
|---|---|---|
| `res_` | Residents | `residents.json` |
| `stf_` | The 10 named staff | `staff.json` |
| `vis_` | The 25 visitors | `visitors.json` |
| `agy_` | Agency carers and nurses, generated at shift start from `rota.json` `agency_pool` | Engine |
| `ext_` | Off-map responders (the on-call second carer, paramedics) | Engine |

References between files always use ids (a resident's `next_of_kin` and `lpa_health`, staff relationships, `accompanies`, relationship edges).

## Schemas

- **Residents:** the full v1 schema (name, dob, room, admission, origin, faith, languages, conditions, life story, Big Five personality, speech style, cognition and memory profile, mobility, continence, nutrition, medication rounds, routine, preferences, legal, staff relationships, goals, triggers) plus a **`care` block** with the mechanical fields the rules read: staff needed for personal care and transfers, transfer method, bed-bound, female carers only, check and repositioning intervals (day/night), whether they can ask for help, toileting, eating support, shower day, glucose check, night wandering, next of kin. Only `care`, `mobility.walk_speed_mps`, `routine`, `room` and `medication_rounds` drive Phase 1 behaviour; the rest is ready for the LLM minds (Phase 3).
- **Staff:** the full v1 staff schema plus `employment` (`permanent`, or `bank` for Lucy and Shanice), `gender` (for Peggy's female-carers rule), `walk_speed_mps` and a fixed `competencies` vocabulary. The rules check `meds_trained` and `fall_assessment`.
- **Visitors:** a lighter card: name, gender, age, relation to resident, short personality, `visit_pattern` (days, arrival window, duration, reliability), optional `accompanies` (visits only together with that visitor, e.g. the Sandhu grandchildren with Harpreet; for them `reliability` is the chance of coming along; for lead visitors it sets the weekly quota, docs/05), optional `may_help_at_meals` (Kuldip: may stay and help Raj eat during protected lunch), visit behaviours, conflicts and walk speed. Occupation, home, emotional state, secrets and off-screen hooks come in Phase 4.
- **Relationship edges:** `{from, to, type, closeness?, tension?, history?, live_issues?}`, undirected, one edge per pair. Visitor-to-resident links live on the visitor card; staff-to-resident rapport lives on the staff and resident cards.

## Validators (`packages/sim-engine/src/data/validate.ts`)

Run by `pnpm test` and by the server at startup:

- Unique ids, correct prefixes, every reference resolves.
- Residents: bed is a real bed point, one resident per bed, each in their own single room with its own en-suite; valid times; walking speed consistent with transfer method; hoist means 2 staff; residents who can't ask for help have scheduled repositioning; next of kin and LPA are one of their own visitors.
- Visitors: valid days and arrival window (no crossing midnight), reliability 0..1, `accompanies` points to a lead visitor for the same resident on the same days; every resident has at least one visitor.
- Relationship edges: no self-edges, no duplicate pairs.
- Rota: shift leads are named staff, late leads are meds-trained, the RN slot is an RN or agency, nobody on two shifts a day, 11 hours' rest (no late then early, no night then day shift).

Not yet validated (Phase 3 persona pipeline): age and date arithmetic across families, cultural consistency across relatives.

## Generation and review

Phase 1 cards are hand-written from the plan's cast, not LLM-generated. The `persona-gen` pipeline (skeleton, LLM narrative fill, validators) comes in Phase 3 at the earliest. Every resident card gets a human read-through for stereotypes and dignity before it is used (constitution: dignity first).

## To be decided

- Versioning and freezing persona sets; how a run references a version (Phase 1 uses the git commit as the data version).

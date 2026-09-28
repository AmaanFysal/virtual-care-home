---
name: new-persona
description: Use when adding or editing a resident, staff member, visitor or relationship in data/personas. Manual only.
disable-model-invocation: true
---

# New persona

1. Read `docs/06-personas-and-families.md` for the schema, ID convention and validators.
2. Ask the user for the role, the facts that must be fixed (age, relationships, conditions), and which persona set version this belongs to. Frozen versions are immutable.
3. Add the entry to the right file in `data/personas/` (`staff.json`, `residents.json`, `visitors.json`, `relationships.json`). Relationship edges must be symmetric where 06 says so.
4. Check care needs against conditions and `docs/05-care-operations.md`; check dates and ages add up.
5. Dignity check: no stereotypes, no caricatured accents or faiths, no dementia played for laughs. Flag anything doubtful to the user for human review.
6. Run validators/tests if they exist, update 06 if the schema changed, and run the `pre-pr` skill.

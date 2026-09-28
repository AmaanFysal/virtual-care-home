---
name: new-scenario
description: Use when adding or changing a director scenario card (fall, sundowning, norovirus, sick call, agency carer, complaint, death, admission, family dispute, birthday, etc.). Director work is Phase 3.
---

# New scenario card

1. Read `docs/10-director-and-scenarios.md` (card schema, pacing, base rates) and `docs/05-care-operations.md` (the correct care process). Check `docs/07-events-and-persistence.md` for the events it will emit.
2. If the director is not built yet (Phase 3), confirm with the user before proceeding.
3. Define the card: trigger conditions, base rate and context modifiers, agents involved, correct process, failure modes. Source the base rate from `docs/research/`.
4. Director randomness uses the seeded RNG; injected cards are recorded inputs with `source: "director"` or `"user"`.
5. Add a golden scenario test per `docs/11-testing.md` asserting the correct process.
6. Update 10 (catalogue) and run the `pre-pr` skill.

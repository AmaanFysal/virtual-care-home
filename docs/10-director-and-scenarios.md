# 10 · Director and scenarios — Phase 3

**Purpose:** the director layer that samples events from base rates, paces drama, and accepts manual injection; and the scenario card catalogue.

> Status: stub, **Phase 3**. Source: [plan-v2](research/plan-v2.md) (Base rates, Scenario catalogue), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §1.

## To be decided

- Scenario card schema: trigger conditions, base rate, agents involved, correct process, failure modes.
- Base-rate sampling and context modifiers (morning fall peak, winter infections, dusk and midday agitation).
- Pacing: how to avoid a disaster every hour.
- The first 15–20 cards and their order.
- Manual injection: what can be injected in Phase 1 (if anything) vs the full injector UI.
- CQC notification tasks triggered by scenarios.
- Keeping the director deterministic (seeded RNG, injections as recorded inputs).

## Notes carried from Phase 1

- **Cancelling a visitor's week.** Phase 1 visitors come on a weekly quota of their pattern days (docs/05 "Visiting"), so there are no random bad weeks. In Phase 3 the director can cancel a visitor's week (or some of its days) with a logged cause, for example illness or a holiday. This replaces random bad weeks with explained ones and gives the event log a reason for a quiet spell (e.g. Arthur going weeks without a visit).
- **Falls** are only injected in Phase 1 (`inject_fall`). The director will sample them from base rates (about 7 to 8 a year for six residents, morning peak, high-risk residents), using the same input path.
- **Already available to scenarios:** the on-call RN coming over (serious night falls), paramedics and conveyance to hospital, the floating night carer's call-outs, CQC Regulation 18 flags, and service-target breaches with causes (`sla.breached`).


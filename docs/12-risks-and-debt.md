# 12 · Risks and debt

**Purpose:** a living register of known risks, caveats and deliberate technical debt, with owners and mitigations.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Caveats), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) (Caveats).

## Known risks (from research, to be triaged)

- Base rates are approximate and context-dependent; treat them as tunable parameters.
- Some workforce figures are secondary sources.
- Model names and prices change often; cost per sim day is an estimate to measure in Phase 2.
- Shared rooms are less common in modern UK homes; say so in demos.
- The 10-person rota cannot cover 24/7 alone; relies on off-map support and agency / bank staff.
- LLM bias and dignity; human review of every persona.
- Not a clinical tool; care processes need RN / care manager review before any real-world use.

## To be decided

- Register format (table with likelihood, impact, mitigation, owner?).
- How deliberate debt is logged and when it must be paid down.

## Findings from the simulation (Phase 1)

- **Night emergencies need three pairs of hands.** With a serious night fall, the night carer stays with the resident until the ambulance (30 to 90 minutes) and the floating carer covers the wing; a two-person request (Raj's pad change) then has only one person free and waits past the 30-minute limit. This is logged as a `request_wait` violation, not hidden. Options for the user: the on-call RN comes over from the main building for emergencies; or accept and report the delay.
- **A serious fall in the morning rush** can delay an hourly bedside check by a few minutes (Dennis). Logged, not hidden.
- **Tuned parameters.** Need rates, priorities and deadline pressure were tuned against these runs (docs/04). They are not measured values.
- **Not generated yet:** PRN (as-needed) medication requests; return from hospital (Phase 3).


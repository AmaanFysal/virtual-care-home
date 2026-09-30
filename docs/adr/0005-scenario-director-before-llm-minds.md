# ADR 0005: Scenario director before LLM minds

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Amaan (project owner)
- **Affected docs:** CLAUDE.md, docs/00-constitution.md, 01, 06, 08, 09, 10, 11, 12, docs/workstreams/phase-1-rules-mvp/, docs/workstreams/phase-2-director/

## Context

Phase 1 ended with a wing that runs ordinary days well: the rules, the audit and the service targets are tuned on calm weeks. The only unplanned event was a fall injected by hand. The roadmap had LLM minds as Phase 2 and the director as Phase 3.

Two things argue for swapping them:

- **Hard days test the rules better than talk does.** Sick calls, falls and outbreaks show whether the rules hold under pressure, which calm weeks can't. Several tuning rules (docs/12) were added to reach zero breaches on calm days; they can only be judged against days that aren't calm.
- **Experiments need repeatable days.** Later air-quality and steriliser experiments must compare the same days with and without an intervention. That needs scripted scenarios replayed exactly, which the director provides and LLM minds don't.

The director doesn't need an LLM: base rates, context modifiers and pacing are arithmetic on a seeded stream.

The constitution (rule 2) said "LLM output (Phase 2+) enters as recorded, timestamped inputs". The constitution changes only by ADR.

## Decision

We will build the scenario director as Phase 2, with no LLM, and move LLM minds to Phase 3. The minds design from 2026-09-29 is kept in docs/09 to pick up then.

The director works like this:

- **Inputs.** Everything it does is an input with `source: "director"`, applied at an exact tick through the same dispatch as manual inputs. Manual triggers from the admin panel use the same input types with `source: "user"`. Each planned event is logged (`director.planned`, with its origin: `random` or `scenario:<id>`) before it applies.
- **Master switch.** It's off by default. When it's off, no director code runs and the event log is byte-identical to the engine before the director existed, which a golden test checks for seeds 1 to 8.
- **What it adds.** It only starts things. The rules react (rota cover, the fall procedure, and later isolation and end-of-life care).
- **Randomness.** Random events come from base rates and context modifiers on a new `director` RNG stream, planned once a day with a day type (ordinary, busy, hard) and pacing caps. Every number lives in `data/director.json`.
- **Scripted scenarios.** Scenarios (`data/scenarios/*.json`) are applied exactly as written, and can run with or without random events.
- **Replay.** Seed, data, director settings, the scenario (its hash is stored in the run row) and user inputs reproduce a run.

We also accept these design decisions:

1. **Hospital admissions** use a placeholder rate (about 3 to 6 a year) for sub-milestones (a) and (b). A source must be cited and `data/director.json` updated before (c).
2. **New admissions** come from `data/personas/admissions.json`; the first card is drafted during development and reviewed by the project owner before use.
3. **Pacing** uses these starting numbers, all in `data/director.json`:
   - day types ordinary 70%, busy 22%, hard 8%;
   - at most one major event a day, and 48 h between majors;
   - at most 2 hard days a week and 2 absences a day;
   - no new outbreak within 14 days of the last one ending.

   Verification checks that the realised rates after the caps still match the base rates, and reports what the caps hold back.
4. **Infection spread** goes through separate, pluggable routes per disease, with per-disease weights in data (flu mostly airborne, norovirus mostly contact).
   - **Contact** route: built in sub-milestone (b).
   - **Airborne** route: until the air model exists, a simple proxy fills it. The risk comes from time in the same room as an infectious person, scaled by the disease's airborne weight, and is logged as "airborne (proxy)". The future air model (room air, for example Wells-Riley, which a steriliser can reduce) replaces the proxy in the same slot.
   - **No double counting:** the routes combine as independent risks, `p = 1 − Π(1 − p_route)`.
   - Steriliser experiments need the real air model, not the proxy.
5. **Deaths.** A director setting `deaths: false` turns off deaths and end-of-life decline for the public demo. It's on by default for experiments.

**Constitution rule 2** now reads: "LLM output (LLM minds, Phase 3) enters as recorded, timestamped inputs, never as a side effect. Director events (Phase 2) enter the same way, as inputs with `source: "director"`, planned from the seed, the director settings and the scenario file, so those replay a run too (ADR-0005)."

## Consequences

- **Easier:**
  - Hard days can be produced on demand, replayed exactly and compared.
  - Service breaches get causes beyond falls (for example "short-staffed: Tom off sick (early), agency from 08:30").
  - The tuning rules in docs/12 can be tested for removal one at a time against a calm-week baseline (sub-milestone e).
- **Harder:**
  - More rules must hold on hard days: rota cover, handovers when someone is missing, and later isolation, outbreaks and deaths.
  - Every rule change must keep the director-off log byte-identical, or the golden fixture must be re-recorded on purpose with a reason.
- **Neutral:** LLM minds wait. Their design is parked in docs/09 and must be re-checked (models, prices) when Phase 3 starts.
- **Follow-up:**
  - sub-milestones (b) outbreaks and isolation, (c) illness, hospital, end of life and admissions, (d) visitors and celebrations, (e) the tuning-debt review;
  - a cited admission rate before (c);
  - the air model, which replaces the airborne proxy.

## Alternatives considered

- **LLM minds first, as planned.** Rejected: talk doesn't stress the rules, and minds would need hard days to have anything worth talking about.
- **A director driven by an LLM.** Rejected: it isn't deterministic without recording every call, costs money per run, and base rates don't need judgement.
- **Director events as direct engine calls, not inputs.** Rejected: inputs are already logged, replayable and shared with manual triggers; a second path would split replay.
- **An empty airborne route until the air model exists.** Rejected: flu would barely spread, so outbreaks would be unrealistic now. The proxy keeps total spread plausible and is swapped out in the same slot.

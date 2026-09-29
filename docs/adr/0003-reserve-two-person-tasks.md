# ADR 0003: Reserve two-person tasks instead of holding them

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Amaan (user), with Claude
- **Affected docs:** docs/04-agents-and-behaviour.md, docs/05-care-operations.md

## Context

A two-person task (Raj's hoist, Dennis's turns and personal care) needs two free staff at once. To stop such a task starving, a carer who was the only one free used to *hold* it: they were assigned to it and waited in the corridor outside the room until a partner was free. Only one task could be held at a time, because two carers each holding a different task would wait for each other for ever.

The Phase 1 behaviour audit (seeds 1 to 8, a week each) found 98 spells of 10 to 18 minutes of a carer standing in the corridor holding a task. Meanwhile one-person work waited: Win's morning care during the 07:00 handover, and Raj's bedtime while the other carer did the 20:00 drinks round. The nurse holding Dennis's morning care also delayed the 08:00 medication round on 34 of 56 mornings.

## Decision

We will **reserve** a waiting two-person task for its one free candidate instead of assigning them to it:

- The reserver stays free for short work only: tea, checks, one-person drink, snack or chat requests, Lounge look-ins, escorts and idle activities. They don't start breaks or anything longer.
- The pair go as soon as the reserver and a partner are both free. If the reserver is on a short task they wait a minute or two for them, unless the task is pressing; then two others go.
- Reservations are made by day after 5 minutes of waiting, or when a turn is pressing: due within 25 minutes, or the floating night carer has come for it. The most pressing is reserved first, before anything else is matched. For a pressing turn, its only possible partner also keeps to short work.
- A reservation lapses if the reserver goes off shift, starts anything longer, or is no longer allowed the task (the nurse from 07:45 until the 08:00 round is done).
- Only one reservation at a time, as before.

## Consequences

- Nobody stands in the corridor holding a task. The audit's corridor flags for day staff fell from 137 to 0; the remaining ones were the floating carer waiting for a turn, and she now does checks while she waits.
- Short work continues around a pending two-person task, so tea, checks and quick requests aren't blocked.
- The matcher is more involved: it tracks reservations, a reserved turn's only partner, and pressing windows. Turn deadlines now matter 25 minutes ahead, so day turns are scheduled 30 minutes ahead (docs/05).
- A reserver can't take long one-person work, so a lone carer may sit on idle activities while waiting for a partner. This is intended, and short.

## Alternatives considered

- **Claim only when two are free at once:** the simplest option, but a two-person task can wait a long time on a busy morning when carers free up at different moments. The user chose reservation.
- **Keep holding, but let the holder do short tasks:** this is the same as reserving, but it leaves a half-assigned task, which confuses the two-person invariant and interruptions.

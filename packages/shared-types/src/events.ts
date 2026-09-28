// Event and input schema. See docs/07-events-and-persistence.md for the catalogue and rules.

import type { ShiftName } from "./data.js";

/** Who caused a change. Constitution rule 5. */
export type Source = "engine" | "director" | "user" | "llm" | "external";

export type MealName = "breakfast" | "lunch" | "supper";
export type DrinkRound = "mid_morning" | "afternoon_tea" | "late_drink";
export type NeedName = "hunger" | "thirst" | "toileting" | "fatigue" | "social";
export type FallSeverity = "minor" | "serious";

/** Summary for one resident, passed on at handover (rules-generated in Phase 1). */
export interface HandoverResidentNote {
  residentId: string;
  falls: number;
  lateOrMissedDoses: number;
  helpRequests: number;
  fluidsBelowTarget: boolean;
  checksDone: number;
}

/** Payload for each event type. Ids, not object references; sim time only. */
export interface EventPayloads {
  "sim.started": { seed: string; startT: number; dataVersion: string };

  "person.arrived": { pointId: string };
  "person.departed": { pointId: string };
  "person.entered_room": { roomId: string; fromRoomId: string | null };
  "person.waited_at_door": { doorId: string };

  "shift.started": { staffId: string; shift: ShiftName; slot: string };
  "shift.ended": { staffId: string; shift: ShiftName; slot: string };
  "agency.spawned": { staffId: string; role: "carer" | "nurse"; shift: ShiftName };
  "break.started": { staffId: string; pointId: string };
  "break.ended": { staffId: string };
  "rn.on_call_started": { nurseLabel: string };
  "rn.on_call_ended": { nurseLabel: string };

  "handover.started": { from: string[]; to: string[]; floorCover: string };
  "handover.completed": { from: string[]; to: string[]; floorCover: string; summary: HandoverResidentNote[] };

  "resident.requested_help": { residentId: string; need: NeedName; taskId: string };
  "task.created": { taskId: string; kind: string; residentId: string | null; dueT: number };
  "task.assigned": { taskId: string; kind: string; staffIds: string[] };
  "task.started": { taskId: string; kind: string };
  "task.interrupted": { taskId: string; kind: string; reason: string };
  "task.resumed": { taskId: string; kind: string };
  "task.completed": { taskId: string; kind: string; residentId: string | null; waitMins: number };

  "care.personal_care_done": { residentId: string; staffIds: string[]; period: "morning" | "evening" };
  "resident.woke": { residentId: string; reason: "routine" | "toilet" };
  "resident.fell_asleep": { residentId: string };
  "resident.got_up": { residentId: string; to: string };
  "resident.went_to_bed": { residentId: string };
  "resident.checked": { residentId: string; staffId: string; sinceLastMins: number; via: "check" | "care" };
  "resident.repositioned": { residentId: string; staffIds: string[] };
  "resident.transferred": { residentId: string; staffIds: string[]; method: "hoist" | "standby" | "assist"; from: string; to: string };

  "meal.served": { residentId: string; meal: MealName; staffId: string };
  "drink.served": { residentId: string; round: DrinkRound; staffId: string };
  "intake.recorded": { residentId: string; mealPct?: number; fluidsMl?: number };

  "med_round.started": { round: string; staffId: string };
  "med_round.completed": { round: string; staffId: string; interruptions: number };
  "med.administered": { residentId: string; round: string; staffId: string; lateMins: number };
  "med.late": { residentId: string; round: string; lateMins: number };
  "med.missed": { residentId: string; round: string };
  "med.prn_requested": { residentId: string; via: "on_call_rn" | "rn" };

  "resident.fell": { residentId: string; severity: FallSeverity; roomId: string };
  "fall.found": { residentId: string; staffId: string };
  "fall.rn_called": { residentId: string; staffId: string; onCall: boolean };
  "fall.assessed": { residentId: string; by: string; outcome: "cleared_to_move" | "wait_for_ambulance" };
  "fall.lifted": { residentId: string; staffIds: string[]; to: string };
  "ambulance.called": { residentId: string; staffId: string };
  "paramedics.arrived": { residentId: string };
  "resident.conveyed_to_hospital": { residentId: string };
  "family.informed": { residentId: string; visitorId: string; staffId: string; reason: string };
  "incident.recorded": { residentId: string; kind: "fall"; severity: FallSeverity };
  "cqc.notification_flagged": { residentId: string; regulation: string; reason: string };

  "second_carer.called": { reason: string; residentIds: string[]; outOfRound: boolean };
  "second_carer.arrived": { personId: string; planned: boolean };
  "second_carer.departed": { personId: string };

  "visit.planned": { visitorId: string; residentId: string; arriveT: number; durationMins: number };
  "visitor.rang_bell": { visitorId: string };
  "visitor.let_in": { visitorId: string; staffId: string };
  "visitor.signed_in": { visitorId: string; staffId: string };
  "visit.started": { visitorId: string; residentId: string; pointId: string };
  "visit.ended": { visitorId: string; residentId: string };
  "visitor.signed_out": { visitorId: string };

  "invariant.violated": { rule: string; details: string };
}

export type EventType = keyof EventPayloads;

export interface SimEvent<K extends EventType = EventType> {
  /** "e" + seq. Derived, never random. */
  id: string;
  /** 1, 2, 3 ... per run, gap-free. */
  seq: number;
  tick: number;
  /** Sim seconds since Mon 2026-11-02 00:00. */
  t: number;
  type: K;
  /** Person ids involved, primary actor first. */
  actors: string[];
  payload: EventPayloads[K];
  source: Source;
}

/** Any event, narrowed by `type`. */
export type AnySimEvent = { [K in EventType]: SimEvent<K> }[EventType];

// ---------------------------------------------------------------- inputs

export interface InputPayloads {
  inject_fall: { residentId: string; severity: FallSeverity };
}

export type InputType = keyof InputPayloads;

/** Something from outside the engine that changes the world. Logged before it is applied. */
export interface SimInput<K extends InputType = InputType> {
  seq: number;
  applyTick: number;
  type: K;
  payload: InputPayloads[K];
  source: Source;
}

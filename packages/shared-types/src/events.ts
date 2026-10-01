// Event and input schema. See docs/07-events-and-persistence.md for the catalogue and rules.

import type { ShiftName } from "./data.js";
import type { AbsenceReason, CelebrationKind, CoverChoice, DayType, Disease, HospitalCause, IllnessKind, WeekOffCause } from "./director.js";

/** Who caused a change. Constitution rule 5. */
export type Source = "engine" | "director" | "user" | "llm" | "external";

export type MealName = "breakfast" | "lunch" | "supper";
/** Drinks rounds, plus tea on waking, a drink with tablets, and a top-up that replaces an old or missed drink. */
export type DrinkRound = "mid_morning" | "afternoon_tea" | "late_drink" | "waking" | "with_meds" | "top_up";
/** Drunk now, left by the resident, or owed (someone who needs help to drink was asleep or busy). */
export type DrinkOutcome = "drunk" | "left" | "owed";
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
  /** Someone taken ill in the middle of work that can't be left is relieved in place by a colleague. */
  "task.handed_over": { taskId: string; kind: string; fromStaffId: string; toStaffId: string; reason: string };
  "task.resumed": { taskId: string; kind: string };
  "task.completed": { taskId: string; kind: string; residentId: string | null; waitMins: number };

  /** A carer called away from personal care to a fall first makes the resident safe: covered for dignity, lying in bed or seated. */
  "care.made_safe": { residentId: string; staffId: string; care: string; position: "lying in bed" | "seated"; covered: boolean; reason: string };
  "care.personal_care_done": { residentId: string; staffIds: string[]; period: "morning" | "evening" };
  "resident.woke": { residentId: string; reason: "routine" | "toilet" };
  /** `where`: in bed, dozing in their bedside chair, or dozing in a Lounge armchair. */
  "resident.fell_asleep": { residentId: string; where: "bed" | "chair" | "lounge" };
  "resident.got_up": { residentId: string; to: string };
  "resident.went_to_bed": { residentId: string };
  "resident.checked": { residentId: string; staffId: string; sinceLastMins: number; via: "check" | "care" };
  "resident.repositioned": { residentId: string; staffIds: string[] };
  "resident.transferred": { residentId: string; staffIds: string[]; method: "hoist" | "standby" | "assist"; from: string; to: string };

  "meal.served": { residentId: string; meal: MealName; staffId: string };
  "drink.served": { residentId: string; round: DrinkRound; staffId: string; outcome: DrinkOutcome };
  "intake.recorded": { residentId: string; mealPct?: number; fluidsMl?: number };

  "med_round.started": { round: string; staffId: string };
  /** Nobody meds-trained is on the wing at a round's time (only with a shift lead's slot left uncovered). */
  "med_round.no_giver": { round: string };
  "med_round.completed": { round: string; staffId: string; interruptions: number };
  "med.administered": { residentId: string; round: string; staffId: string; lateMins: number };
  "med.late": { residentId: string; round: string; lateMins: number };
  "med.missed": { residentId: string; round: string };
  "med.prn_requested": { residentId: string; via: "on_call_rn" | "rn" };

  "resident.fell": { residentId: string; severity: FallSeverity; roomId: string };
  "fall.found": { residentId: string; staffId: string };
  /** Nobody could come to a fall: help was asked for (at night the floating carer or on-call RN; otherwise the next person free). */
  "fall.help_requested": { residentId: string; reason: string; called: "floating_carer" | "on_call_rn" | "on_the_way" | "next_free" };
  /** Left for a few minutes while their carer helps lift another resident: assessed, not injured, made comfortable (pillow, blanket). */
  "fall.made_comfortable": { residentId: string; staffId: string; reason: string };
  /** A look-in on a resident left waiting on the floor (at least every 5 minutes until lifted). */
  "fall.checked": { residentId: string; staffId: string; sinceMins: number };
  /** The nurse waiting with a resident for an ambulance hands over to a carer, so she can assess others. */
  "fall.handed_over": { residentId: string; fromStaffId: string; toStaffId: string; reason: string };
  "fall.rn_called": { residentId: string; staffId: string; onCall: boolean };
  "fall.assessed": { residentId: string; by: string; outcome: "cleared_to_move" | "wait_for_ambulance" };
  "fall.lifted": { residentId: string; staffIds: string[]; to: string };
  "ambulance.called": { residentId: string; staffId: string; cause?: HospitalCause };
  "paramedics.arrived": { residentId: string };
  "resident.conveyed_to_hospital": { residentId: string; cause?: HospitalCause };
  /** Back from hospital to their own bed (how long depends on why they went, docs/10). */
  "resident.returned_from_hospital": { residentId: string; daysAway: number; cause?: HospitalCause };
  /** A change to a resident's care profile (e.g. after a hospital stay), kept as an override of their card. */
  "resident.care_changed": { residentId: string; reason: string; changes: string[]; untilT: number | null };
  /** An illness looked after in the home (mild) or needing the GP and hospital (severe). */
  "illness.started": { residentId: string; kind: IllnessKind; severity: "mild" | "severe" };
  "illness.recovered": { residentId: string; kind: IllnessKind };
  "gp.consulted": { residentId: string; kind: IllnessKind; outcome: "admit" | "treat_at_home" };
  /** Their end-of-life care begins (docs/10): more comfort care, family visiting more and later. */
  "end_of_life.started": { residentId: string; expectedDays: number };
  /** Recorded quietly: their family is told and their room is left empty for now. */
  "resident.died": { residentId: string; roomId: string };
  /** A new resident moves in (data/personas/admissions.json). */
  "resident.admitted": { residentId: string; roomId: string; cardId: string };
  /** Post-fall observations are over (the resident's "obs" badge clears). */
  "fall.observations_ended": { residentId: string };
  "family.informed": { residentId: string; visitorId: string; staffId: string; reason: string };
  "incident.recorded": { residentId: string; kind: "fall"; severity: FallSeverity };
  "cqc.notification_flagged": { residentId: string; regulation: string; reason: string };

  "second_carer.called": { reason: string; residentIds: string[]; outOfRound: boolean };
  "second_carer.arrived": { personId: string; planned: boolean };
  "second_carer.departed": { personId: string };

  /** A group activity in the Lounge (Bev's sessions). */
  "activity.started": { staffId: string; activity: string; roomId: string; residentIds: string[] };
  "activity.ended": { staffId: string; activity: string; roomId: string; residentIds: string[] };

  "visit.planned": { visitorId: string; residentId: string; arriveT: number; durationMins: number };
  "visitor.rang_bell": { visitorId: string };
  "visitor.let_in": { visitorId: string; staffId: string };
  "visitor.signed_in": { visitorId: string; staffId: string };
  "visit.started": { visitorId: string; residentId: string; pointId: string };
  "visit.ended": { visitorId: string; residentId: string };
  "visitor.signed_out": { visitorId: string };

  /** Every care staff member on the wing is with a fallen resident: a carer from the main building is asked for (about 15 minutes, if one is free). */
  "main_carer.called": { reason: string; available: boolean; arriveT: number | null };
  "main_carer.arrived": { personId: string };
  "main_carer.departed": { personId: string };
  /** `residentId` is null when she comes for something other than a fall (a medication round nobody on the wing can give). */
  "on_call_rn.called": { residentId: string | null; reason: string };
  "on_call_rn.arrived": { personId: string; residentId: string };
  "on_call_rn.departed": { personId: string };

  /** The director's plan for a day (docs/10): its type, and how many events it planned and held back. */
  "director.day_planned": { day: number; dayType: DayType | "scripted"; planned: number; suppressed: number; downgradedFrom?: DayType };
  /** An event the director will apply at `applyT`, and why ("random" base rates or "scenario:<id>"). */
  "director.planned": { inputType: InputType; applyT: number; origin: string; reason: string; params: InputPayloads[InputType] };
  /** An event drawn from the base rates but held back by a pacing cap. */
  "director.suppressed": { inputType: InputType; applyT: number; reason: string; params: InputPayloads[InputType] };
  /** An input (planned or manual) that didn't apply when its time came, e.g. the resident is in hospital. */
  "input.skipped": { inputType: InputType; reason: string; params: InputPayloads[InputType] };

  /** A rostered worker won't be in: a sick call, or an agency worker who didn't turn up. */
  "staff.absent": { staffId: string; name: string; slot: string; shift: ShiftName; reason: AbsenceReason; shiftStartT: number };
  /** Cover for an absence: a bank carer, an agency worker, or at night a carer from the main building, with the late carer staying on until she arrives (`untilT`). */
  "rota.cover_booked": { slot: string; shift: ShiftName; forStaffId: string; cover: "bank" | "agency" | "stay_on" | "main_building"; staffId: string; arriveT: number; untilT?: number };
  /** Nobody could cover: the shift runs short. */
  "rota.no_cover": { slot: string; shift: ShiftName; forStaffId: string; reason: string };

  /** Someone caught an infection (docs/10): by `contact`, the `airborne (proxy)` route, or `introduced` from outside. `roomId` is where. */
  "infection.exposed": { personId: string; disease: Disease; route: "contact" | "airborne (proxy)" | "introduced"; sourceId: string | null; roomId: string | null };
  "infection.symptomatic": { personId: string; disease: Disease; roomId: string | null };
  /** Symptoms over (still infectious for a while, and isolated or off work until later). */
  "infection.recovered": { personId: string; disease: Disease };
  /** A resident isolated in their room: care and meals there, no Lounge, PPE for every visit. */
  "infection.isolated": { personId: string; disease: Disease; roomId: string | null };
  "infection.isolation_ended": { personId: string; disease: Disease };
  /** Two cases of the same disease within 48 hours: the Lounge closes and only essential visits go ahead. */
  "outbreak.declared": { disease: Disease; cases: string[] };
  /** 48 hours with no new case. */
  "outbreak.over": { disease: Disease; cases: string[]; days: number };
  /** A planned visit that can't go ahead (an outbreak: only essential visits; a week off). */
  "visit.cancelled": { visitorId: string; residentId: string; reason: string };
  /** A regular visitor misses this week (docs/10, sub-milestone d), with the cause. */
  "visitor.week_off": { visitorId: string; residentId: string; cause: WeekOffCause; untilT: number };
  /** A birthday or festival: the family come, and tea and cake (none of it during an outbreak). */
  "celebration.started": { kind: CelebrationKind; name: string; residentIds: string[]; gathering: boolean; reason?: string };
  /** Tea and cake: in the Lounge, or in the resident's room; led by Bev when she's on (staffId null: with the carers' afternoon tea). */
  "celebration.tea": { name: string; roomId: string; staffId: string | null; residentIds: string[]; visitorIds: string[] };

  /**
   * The building (v1.0-testbed): a door's or window's set state changed. `byId` is whoever changed it
   * (null when it's a rule of the building, e.g. fire doors closing at 22:00). Passing through a
   * closed door isn't logged: it's in the world description, rebuilt exactly by replay.
   */
  "door.opened": { doorId: string; byId: string | null; reason: string };
  "door.closed": { doorId: string; byId: string | null; reason: string };
  "door.set_ajar": { doorId: string; byId: string | null; reason: string };
  "door.locked": { doorId: string; byId: string | null; reason: string };
  "window.opened": { windowId: string; roomId: string; byId: string | null; reason: string };
  "window.closed": { windowId: string; roomId: string; byId: string | null; reason: string };
  /** Equipment switched on (or a light's level changed: `level`), or off. */
  "equipment.turned_on": { equipmentId: string; kind: string; roomId: string; byId: string | null; level?: "dim" | "full"; reason: string };
  "equipment.turned_off": { equipmentId: string; kind: string; roomId: string; byId: string | null; reason: string };
  /** An instant use: a WC flushed, a basin tap run to wash hands. */
  "equipment.used": { equipmentId: string; kind: string; roomId: string; byId: string };
  "heating.set_point_changed": { equipmentId: string; roomId: string; setpointC: number; reason: string };

  /** A hard safety rule broke: must never happen (docs/11). */
  "invariant.violated": { rule: string; details: string };
  /** A service target was missed: reported, not a failure (docs/11). */
  "sla.breached": { target: ServiceTarget; residentId: string; details: string; cause: string };
}

/** Service targets (docs/11): reported when missed, not failures. */
export type ServiceTarget = "request_wait" | "resident_check" | "reposition" | "lounge_supervision" | "fall_attendance" | "fall_waiting_check";

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
  /** The staff member's next shift that hasn't started yet is lost; cover is sought (docs/10). */
  staff_sick: { staffId: string; cover?: CoverChoice };
  /** Whoever holds the slot's next shift doesn't turn up; cover is sought from the shift start. */
  shift_no_show: { slot: string; cover?: CoverChoice };
  /** Someone falls ill with an infection brought in from outside (symptoms now); it may spread (docs/10). */
  infection_case: { personId: string; disease: Disease };
  /** A resident falls ill (docs/10): mild (looked after at home) or severe (GP, then hospital). */
  resident_illness: { residentId: string; kind: IllnessKind; severity: "mild" | "severe" };
  /** Their end-of-life decline begins; they die after about `expectedDays` (skipped when deaths are off). */
  end_of_life_start: { residentId: string; expectedDays: number };
  /** A new resident moves into an empty room (a reviewed card from data/personas/admissions.json). */
  admission: { cardId: string };
  /** A visitor misses the rest of this week, with the cause (docs/10, sub-milestone d). */
  visitor_week_off: { visitorId: string; cause: WeekOffCause };
  /** Today is a birthday or festival for these residents: family visits and tea and cake. */
  celebration: { kind: CelebrationKind; name: string; residentIds: string[] };
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

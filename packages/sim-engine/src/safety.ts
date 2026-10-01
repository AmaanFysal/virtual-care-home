// Safety, care-plan and integrity invariants from the simulation audit (2026-09-30). Read-only:
// after each step it looks at the world and the events that step produced, and reports anything
// that should never happen. Some rules need history (how long a need has been high, whether an
// isolated resident has been back in their room), so it's a monitor with its own memory, kept out
// of the world so runs are unchanged.
//
// Not wired into the engine's own logging (sim.ts `logInvariants`) yet: runs, event logs and the
// director-off fixture are exactly as before. The audit's fuzz runner (scripts/fuzz.ts) and the
// realism review call it every tick, alongside `checkInvariants`.

import { dayIndex, type AnySimEvent, type NeedName } from "@vch/shared-types";
import { checkInvariants } from "./invariants.js";
import { outbreakOn } from "./infection.js";
import { isMedsTrained } from "./meds.js";
import { noAppetite } from "./needs.js";
import { isCareStaff, type Person, type Task, type World } from "./state.js";
import { cellAt } from "./world/grid.js";

export type Severity = "unsafe" | "unrealistic" | "integrity";

export interface SafetyViolation {
  rule: string;
  severity: Severity;
  /** Distinguishes separate failures of one rule (a resident, a task, a day). */
  key: string;
  t: number;
  details: string;
}

/** Every rule, with its severity and what it means (the audit report lists these). */
export const SAFETY_RULES = {
  // The engine's own hard invariants (invariants.ts), reported here too.
  floor_cover: { severity: "unsafe", text: "No on-duty care staff on the floor" },
  standing_spot: { severity: "integrity", text: "Two stationary people share a grid cell" },
  two_person: { severity: "unsafe", text: "Two-person care performed with fewer than two staff at the resident" },
  rn_reachable: { severity: "unsafe", text: "No RN on the wing and none on call" },
  fall_unattended: { severity: "unsafe", text: "A fallen resident with nobody attending and no help asked for" },
  no_visitors_in_staff_room: { severity: "integrity", text: "A visitor in the staff room" },
  // Infection control and visiting.
  isolated_visitors_over_limit: { severity: "unsafe", text: "An isolated resident (not at the end of life) has more visitors with them at once than the limit (ECS_LIMIT, 2)" },
  isolated_in_lounge: { severity: "unsafe", text: "An isolated resident is in the Lounge (after 20 minutes' grace to be walked back)" },
  isolated_left_room: { severity: "unsafe", text: "An isolated resident is outside their own room (after being back in it, or 30 minutes after isolation began)" },
  outbreak_lounge_use: { severity: "unsafe", text: "The Lounge is used during an outbreak (a resident there 30 minutes after it was declared, or an activity started)" },
  isolation_too_short: { severity: "unrealistic", text: "A resident with flu came out of isolation less than 5 days after their symptoms began (UKHSA 2024: a minimum of 5 days)" },
  admission_during_outbreak: { severity: "unsafe", text: "A new resident moved in while an outbreak was on" },
  sick_staff_on_wing: { severity: "unsafe", text: "A member of staff with symptoms is on the wing more than 60 minutes after they began, or starts a shift while excluded" },
  sick_staff_giving_care: { severity: "unsafe", text: "A member of staff with symptoms is giving resident care more than 5 minutes after they began" },
  eol_visit_cancelled: { severity: "unsafe", text: "A visit to a resident at the end of their life was cancelled or cut short for an outbreak" },
  ecs_visit_cancelled: { severity: "unrealistic", text: "A resident's next of kin turned away by a blanket outbreak restriction (UKHSA 2024: visits should not normally be restricted; Regulation 9A)" },
  visitor_in_ensuite: { severity: "unsafe", text: "A visitor is in a resident's en-suite" },
  // Residents who aren't on the wing.
  care_for_absent_resident: { severity: "integrity", text: "Care, a meal, a check, a dose or a visit logged for a resident in hospital or who has died" },
  task_for_absent_resident: { severity: "integrity", text: "A task exists for a resident in hospital or who has died" },
  absent_resident_state: { severity: "integrity", text: "A resident off the wing is still on the floor, busy or asking for help, or visitors stay with nobody to see" },
  // Care plans (the resident's card).
  female_only_by_man: { severity: "unsafe", text: "Personal care for a resident with female carers only, done with a man" },
  meds_trained: { severity: "unsafe", text: "Medication given by someone not meds-trained" },
  fall_moved_before_assessment: { severity: "unsafe", text: "A fallen resident moved before they were assessed" },
  long_lie: { severity: "unsafe", text: "A resident on the floor after a fall for more than 2 hours (a long lie)" },
  time_critical_dose_late: { severity: "unsafe", text: "A time-critical dose (Parkinson's) given more than 30 minutes late, or missed" },
  dose_skipped_unrecorded: { severity: "unsafe", text: "A round finished with a resident on the wing given no dose and nothing recorded (not given, not missed)" },
  fluid_limit_exceeded: { severity: "unsafe", text: "A resident on a fluid restriction (heart failure) given more than their daily limit" },
  diet_texture: { severity: "unsafe", text: "A resident on a soft, bite-sized diet (IDDSI 6, dysphagia) given a biscuit, toast or a sandwich" },
  request_from_nonrequester: { severity: "integrity", text: "A resident whose card says they can't ask for help asked for help" },
  meal_for_comfort_only: { severity: "integrity", text: "A meal served to a resident on comfort feeding only" },
  bed_bound_out_of_bed: { severity: "unsafe", text: "A bed-bound resident out of bed (not after a fall)" },
  seated_too_long: { severity: "unsafe", text: "A resident who can't change position themselves (hoisted) sitting out of bed more than 6 hours at a stretch (NICE CG179: at least every 6 hours if at risk)" },
  escort_apart: { severity: "unsafe", text: "A resident walked by a carer (an escort) is walking with the carer more than 2 m away and not closing the gap, for two ticks (10 s) or more than 3 m" },
  need_unmet_staff_idle: { severity: "unsafe", text: "A resident's hunger, thirst or toileting over 0.9 for more than an hour while enough carers who could help are idle" },
  request_unanswered_2h: { severity: "unsafe", text: "A resident's request for help not started 2 hours after they asked (the target is 30 minutes)" },
  no_woman_for_female_only: { severity: "unsafe", text: "Female-only personal care waiting over an hour with no woman on shift on the wing" },
  // End of life and hospital.
  eol_conveyed_to_hospital: { severity: "unrealistic", text: "A resident on a planned end-of-life decline taken to hospital" },
  died_on_return: { severity: "unrealistic", text: "A resident died within 2 hours of coming back from hospital" },
  death_not_in_bed: { severity: "unrealistic", text: "A resident died out of bed" },
  // Staff hours and staffing.
  no_break: { severity: "unrealistic", text: "A member of staff worked a shift over 6 hours with no break (Working Time Regulations: 20 minutes)" },
  office_covered_by_carer: { severity: "unrealistic", text: "An office or reception shift (manager, activities, receptionist) was covered by a bank or agency carer" },
  lone_carer_two_person_due: { severity: "unsafe", text: "By day, two-person care waiting over an hour with only one carer on the wing and no help sent for" },
  excessive_hours: { severity: "unsafe", text: "A member of staff on the wing more than 14 hours at a stretch, or back with under 11 hours' rest" },
  // Realism.
  turn_repeated: { severity: "unrealistic", text: "A resident turned again less than an hour after their last turn" },
  meds_while_asleep: { severity: "unrealistic", text: "Tablets given to a resident who is asleep" },
  drink_for_fallen: { severity: "unrealistic", text: "A drink served or left for a resident lying on the floor after a fall" },
  asleep_on_floor: { severity: "unrealistic", text: "A resident asleep on the floor after a fall" },
  // Bookkeeping that would leave someone stuck.
  shared_seat: { severity: "integrity", text: "Two people sitting on the same seat, or two residents in one bed" },
  off_walkable: { severity: "integrity", text: "Someone off walkable floor (inside a wall or furniture) or in the wrong room for where they stand" },
  orphan_task: { severity: "integrity", text: "A task, fall log, ambulance call or assignment left pointing at something that no longer exists" },
  stuck_external: { severity: "integrity", text: "Paramedics or the on-call RN left on the wing with nothing to do" },
  float_overstay: { severity: "unrealistic", text: "The floating night carer (shared with the main building) on the wing more than 4 hours at a stretch" },
} as const satisfies Record<string, { severity: Severity; text: string }>;

export type SafetyRule = keyof typeof SAFETY_RULES;

/**
 * Visitors allowed with an isolated resident at once (project owner, 2026-10-01: up to 2; UKHSA's
 * 2024 guidance sets no number, only in-room visits with precautions). Moves to data/director.json
 * with the visiting changes (the sim-audit workstream, PR E).
 */
export const ECS_LIMIT = 2;
const HOUR = 3600;
const MIN = 60;

const CARE_EVENTS = new Set([
  "meal.served",
  "drink.served",
  "resident.checked",
  "med.administered",
  "med.missed",
  "med.late",
  "care.personal_care_done",
  "resident.repositioned",
  "intake.recorded",
  "visit.started",
  "resident.requested_help",
  "resident.transferred",
  "resident.got_up",
  "resident.went_to_bed",
  "fall.checked",
]);
const SNACK_ROUNDS = new Set(["mid_morning", "afternoon_tea", "late_drink"]);
const PERSONAL_CARE = new Set(["morning", "bedtime", "pad_change", "reposition"]);
const EXTERNALS = { paramedics: "ext_paramedics", rn: "ext_oncall_rn" };

export interface SafetyMonitor {
  /** Checks the world after a step, with the events that step produced. */
  check(world: World, events: AnySimEvent[]): SafetyViolation[];
}

function first(p: Person): string {
  return p.name.split(" ")[0]!;
}

function ownRooms(world: World, r: Person): Set<string> {
  const room = r.resident!.data.room;
  const rooms = new Set<string>();
  const bed = world.points.get(room);
  if (bed) rooms.add(bed.room);
  const wc = world.points.get(`${room.split(".")[0]}.WC`);
  if (wc) rooms.add(wc.room);
  return rooms;
}

/** A task that has someone with a resident (not the door, the Lounge post or notes). */
function residentFacing(task: Task): boolean {
  if (task.kind === "idle") return task.data.activity === "sit_with" || task.data.activity === "checks";
  return !!task.residentId || task.kind === "round" || task.kind === "med_round";
}

export function createSafetyMonitor(): SafetyMonitor {
  const isolation = new Map<string, { since: number; beenIn: boolean }>();
  let outbreakSince: number | null = null;
  const needHigh = new Map<string, number>();
  const rounds = new Map<string, { residents: Set<string>; dosed: Set<string> }>();
  const absent = new Set<string>();
  const absentSince = new Map<string, number>();
  const returnedT = new Map<string, number>();
  const onMapSince = new Map<string, number>();
  const leftT = new Map<string, number>();
  const extSince = new Map<string, number>();
  const lastTurn = new Map<string, number>();
  const outOfBedSince = new Map<string, number>();
  const escortGap = new Map<string, { gap: number; ticks: number }>();

  return {
    check(world, events) {
      const out: SafetyViolation[] = [];
      const t = world.t;
      const v = (rule: SafetyRule, key: string, details: string) => out.push({ rule, severity: SAFETY_RULES[rule].severity, key: `${rule}:${key}`, t, details });
      const people = world.order.map((id) => world.people.get(id)!);
      const residents = people.filter((p) => p.resident);
      const minute = t % 60 === 0;

      // ------------------------------------------------ the engine's own hard invariants
      for (const e of checkInvariants(world)) {
        const rule = e.rule as SafetyRule;
        if (rule in SAFETY_RULES) v(rule, e.key ?? e.details, e.details);
      }

      // ------------------------------------------------ events this tick, in order
      const leftThisTick = new Set<string>();
      for (const e of events) {
        const p = e.payload as Record<string, unknown>;
        const rid = typeof p.residentId === "string" ? p.residentId : null;
        const r = rid ? world.people.get(rid) : undefined;
        // Residents leaving or coming back, in event order, so care logged just before they go counts.
        if (e.type === "resident.conveyed_to_hospital" || e.type === "resident.died") leftThisTick.add(rid!);
        if (e.type === "resident.returned_from_hospital") {
          leftThisTick.delete(rid!);
          absent.delete(rid!);
          absentSince.delete(rid!);
          returnedT.set(rid!, t);
        }
        if (e.type === "resident.admitted") {
          absent.delete(rid!);
          if (outbreakOn(world)) v("admission_during_outbreak", rid!, `${world.people.get(rid!)?.name ?? rid} moved in during an outbreak`);
        }
        const gone = (id: string) => absent.has(id) || leftThisTick.has(id);
        // A dose recorded as not given because they've left is a record, not care.
        const record = e.type === "med.missed" && typeof p.reason === "string";
        if (CARE_EVENTS.has(e.type) && rid && gone(rid) && !record) v("care_for_absent_resident", `${e.type}:${rid}:${t}`, `${e.type} for ${r?.name ?? rid}, who is ${r?.resident?.away ?? "away"}`);
        if (e.type === "task.started") for (const a of e.actors) if (world.people.get(a)?.resident && gone(a)) v("care_for_absent_resident", `task:${a}:${t}`, `a task started with ${world.people.get(a)!.name}, who is ${world.people.get(a)!.resident!.away}`);

        if (e.type === "med_round.started") {
          const key = `${String(p.round)}@${dayIndex(t)}`;
          rounds.set(key, { residents: new Set(residents.filter((q) => q.onMap).map((q) => q.id)), dosed: new Set() });
        }
        // A delay recorded with its reason is on the chart too (the dose follows, or is recorded as missed).
        if (e.type === "med.delayed") rounds.get(`${String(p.round)}@${dayIndex(t)}`)?.dosed.add(rid!);
        if (e.type === "med.administered" || e.type === "med.missed") {
          rounds.get(`${String(p.round)}@${dayIndex(t)}`)?.dosed.add(rid!);
          const card = r?.resident?.data.care;
          // Missed because they were taken to hospital (or died) first: the hospital gives it from then on.
          const leftFirst = e.type === "med.missed" && gone(rid!);
          if (card?.time_critical_meds && !leftFirst && (e.type === "med.missed" || Number(p.lateMins) > 30)) {
            v("time_critical_dose_late", `${rid}:${String(p.round)}:${dayIndex(t)}`, `${r!.name}'s ${String(p.round)} dose ${e.type === "med.missed" ? "missed" : `${String(p.lateMins)} min late`} (time-critical: within 30 minutes)`);
          }
        }
        if (e.type === "med.administered") {
          const giver = world.people.get(String(p.staffId));
          if (giver && !isMedsTrained(giver)) v("meds_trained", `${String(p.staffId)}:${t}`, `${giver.name} gave ${r?.name}'s medication`);
          if (r?.resident?.asleep) v("meds_while_asleep", `${rid}:${String(p.round)}:${dayIndex(t)}`, `${r.name} given the ${String(p.round)} tablets while asleep`);
        }
        if (e.type === "med_round.completed") {
          const key = `${String(p.round)}@${dayIndex(t)}`;
          const rec = rounds.get(key);
          if (rec) {
            for (const id of rec.residents) {
              const q = world.people.get(id);
              if (!q?.onMap || rec.dosed.has(id)) continue;
              v("dose_skipped_unrecorded", `${id}:${key}`, `${q.name} was on the wing but got no ${String(p.round)} dose and none was recorded as missed`);
            }
            rounds.delete(key);
          }
        }
        if (e.type === "drink.served" && r?.resident) {
          const diet = r.resident.data.nutrition.diet;
          if (SNACK_ROUNDS.has(String(p.round)) && p.outcome === "drunk" && /iddsi|soft/i.test(diet)) {
            v("diet_texture", `${rid}:${String(p.round)}:${dayIndex(t)}`, `${r.name} (${diet}) given a ${p.round === "late_drink" ? "supper snack (toast or a sandwich)" : "biscuit"} on the ${String(p.round)} round`);
          }
          if (r.resident.fall) v("drink_for_fallen", `${rid}:${t}`, `${r.name} given a drink (${String(p.outcome)}) while on the floor after a fall`);
        }
        if (e.type === "resident.repositioned" && rid) {
          const before = lastTurn.get(rid);
          if (before !== undefined && t - before < HOUR) v("turn_repeated", `${rid}:${t}`, `${r?.name} turned again ${Math.round((t - before) / 60)} min after the last turn`);
          lastTurn.set(rid, t);
        }
        if (e.type === "resident.requested_help" && r?.resident && !r.resident.data.care.can_request_help) v("request_from_nonrequester", `${rid}:${t}`, `${r.name} asked for help (${String(p.need)}) but can't use the call bell`);
        if (e.type === "meal.served" && r?.resident && noAppetite(r.resident.data)) v("meal_for_comfort_only", `${rid}:${t}`, `${r.name} served ${String(p.meal)} on comfort feeding only`);
        if (e.type === "activity.started" && outbreakOn(world)) v("outbreak_lounge_use", `activity:${t}`, `${String(p.activity)} started in ${String(p.roomId)} during an outbreak`);
        if (e.type === "resident.conveyed_to_hospital" && r?.resident?.endOfLife) v("eol_conveyed_to_hospital", `${rid}:${t}`, `${r.name} taken to hospital (${String(p.cause)}) during a planned end-of-life decline`);
        if (e.type === "resident.died" && r?.resident) {
          const back = returnedT.get(rid!);
          if (back !== undefined && t - back <= 2 * HOUR) v("died_on_return", rid!, `${r.name} died ${Math.round((t - back) / 60)} min after coming back from hospital`);
          if (!r.resident.inBed) v("death_not_in_bed", rid!, `${r.name} died out of bed (last at ${r.resident.data.room.split(".")[0]}, posture ${r.posture})`);
        }
        if (e.type === "visit.cancelled" && r?.resident && String(p.reason).startsWith("outbreak")) {
          if (r.resident.endOfLife) v("eol_visit_cancelled", `${String(p.visitorId)}:${t}`, `${world.people.get(String(p.visitorId))?.name}'s visit to ${r.name}, at the end of their life, cancelled for the outbreak`);
          else if (String(p.visitorId) === r.resident.data.care.next_of_kin) v("ecs_visit_cancelled", `${String(p.visitorId)}:${dayIndex(t)}`, `${world.people.get(String(p.visitorId))?.name} (${first(r)}'s next of kin) turned away for the outbreak`);
        }
        if (e.type === "infection.isolation_ended") {
          const q = world.people.get(String(p.personId));
          const inf = q?.infection;
          if (q?.resident && inf?.disease === "flu" && t - inf.symptomaticFromT < 5 * 24 * HOUR) v("isolation_too_short", `${q.id}:${inf.symptomaticFromT}`, `${q.name}'s flu isolation ended ${((t - inf.symptomaticFromT) / (24 * HOUR)).toFixed(1)} days after symptoms began`);
        }
        if (e.type === "shift.ended") {
          const s = world.people.get(String(p.staffId));
          const a = s?.staff?.shift;
          if (s?.staff && isCareStaff(s) && a && a.endT - a.startT > 6 * HOUR && !s.staff.breakTaken) v("no_break", `${s.id}:${a.startT}`, `${s.name} worked the ${String(p.shift)} shift (${((a.endT - a.startT) / HOUR).toFixed(1)} h) with no break`);
        }
        if (e.type === "rota.cover_booked" && (p.slot === "office" || p.slot === "reception")) v("office_covered_by_carer", `${String(p.staffId)}:${t}`, `${world.people.get(String(p.staffId))?.name ?? p.staffId} (${String(p.cover)}) booked for the ${String(p.slot)} slot of ${world.people.get(String(p.forStaffId))?.name ?? p.forStaffId}`);
        if (e.type === "shift.started") {
          const s = world.people.get(String(p.staffId));
          if (s?.infection?.isolated && s.infection.symptomaticFromT < t) v("sick_staff_on_wing", `${s.id}:start:${t}`, `${s.name} started a ${String(p.shift)} shift while off sick with ${s.infection.disease}`);
        }
      }
      for (const id of leftThisTick) absent.add(id);

      // ------------------------------------------------ residents
      const outbreak = outbreakOn(world);
      if (outbreak) outbreakSince ??= t;
      else outbreakSince = null;
      for (const r of residents) {
        const res = r.resident!;
        if (!r.onMap) {
          absent.add(r.id);
          if (!absentSince.has(r.id)) absentSince.set(r.id, t);
          if (res.fall || res.busyTaskId || res.requestId) v("absent_resident_state", r.id, `${r.name} is ${res.away ?? "off the wing"} but ${res.fall ? "still on the floor" : res.busyTaskId ? `busy with ${res.busyTaskId}` : "asking for help"}`);
          continue;
        }
        const inf = r.infection;
        // Isolation.
        if (inf?.isolated) {
          const iso = isolation.get(r.id) ?? { since: t, beenIn: false };
          isolation.set(r.id, iso);
          const inOwn = !!r.roomId && ownRooms(world, r).has(r.roomId);
          if (inOwn) iso.beenIn = true;
          else if (!res.fall) {
            if (r.roomId === "Lounge" && t - iso.since > 20 * MIN) v("isolated_in_lounge", r.id, `${r.name} (isolated, ${inf.disease}) in the Lounge ${Math.round((t - iso.since) / 60)} min after isolation began`);
            if (iso.beenIn) v("isolated_left_room", `${r.id}:${iso.since}`, `${r.name} (isolated, ${inf.disease}) left their room for ${r.roomId}`);
            else if (t - iso.since > 30 * MIN) v("isolated_left_room", `${r.id}:${iso.since}`, `${r.name} (isolated, ${inf.disease}) still in ${r.roomId} ${Math.round((t - iso.since) / 60)} min after isolation began`);
          }
          const endOfLife = !!res.endOfLife || res.data.conditions.some((c) => /end of life/i.test(c));
          if (!endOfLife) {
            const with_ = people.filter((q) => q.onMap && q.visitor?.residentId === r.id && (q.visitor.phase === "visiting" || q.visitor.phase === "to_resident"));
            if (with_.length > ECS_LIMIT) v("isolated_visitors_over_limit", `${r.id}:${dayIndex(t)}`, `${r.name} (isolated, ${inf.disease}) has ${with_.length} visitors: ${with_.map(first).join(", ")}`);
          }
        } else isolation.delete(r.id);
        // The Lounge during an outbreak.
        if (outbreak && outbreakSince !== null && r.roomId === "Lounge" && t - outbreakSince > 30 * MIN) v("outbreak_lounge_use", r.id, `${r.name} in the Lounge ${Math.round((t - outbreakSince) / 60)} min into an outbreak`);
        // Card.
        if (res.data.care.bed_bound && !res.inBed && !res.fall) v("bed_bound_out_of_bed", r.id, `${r.name} (bed-bound) out of bed at ${r.atPoint ?? r.roomId}`);
        // Someone hoisted can't shift their own weight: sitting out all day without a change of position.
        if (res.data.care.transfer_method === "hoist" && !res.inBed && !res.fall) {
          const since = outOfBedSince.get(r.id) ?? t;
          outOfBedSince.set(r.id, since);
          if (t - since > 6 * HOUR) v("seated_too_long", `${r.id}:${since}`, `${r.name} sitting out of bed for ${((t - since) / HOUR).toFixed(1)} h with no change of position`);
        } else outOfBedSince.delete(r.id);
        if (res.fall && !res.fall.assessed && (r.posture !== "on_floor" || r.atPoint !== `Fall.${r.id}`)) v("fall_moved_before_assessment", `${r.id}:${res.fall.t}`, `${r.name} moved (${r.posture} at ${r.atPoint}) before assessment`);
        if (res.fall && t - res.fall.t > 2 * HOUR) v("long_lie", `${r.id}:${res.fall.t}`, `${r.name} on the floor for ${Math.round((t - res.fall.t) / 60)} min (${res.fall.severity} fall, ${res.fall.assessed ? "assessed" : "not yet assessed"})`);
        if (res.fall && res.asleep) v("asleep_on_floor", `${r.id}:${res.fall.t}`, `${r.name} asleep on the floor`);
        const limit = res.data.nutrition.fluid_limit_ml;
        if (limit && res.fluidsMlToday > limit) v("fluid_limit_exceeded", `${r.id}:${dayIndex(t - 7 * HOUR)}`, `${r.name} given ${res.fluidsMlToday} ml today against a ${limit} ml limit${res.illness ? ` (ill: ${res.illness.kind}, fluids pushed)` : ""}`);
        // Unmet needs while a carer who could help is idle (once a minute).
        if (minute) {
          for (const need of ["hunger", "thirst", "toileting"] as NeedName[]) {
            if (need === "hunger" && noAppetite(res.data)) continue;
            const key = `${r.id}:${need}`;
            const high = res.needs[need] >= 0.9 && !res.fall && (need === "toileting" || !res.asleep);
            if (!high) {
              needHigh.delete(key);
              continue;
            }
            const since = needHigh.get(key) ?? t;
            needHigh.set(key, since);
            if (t - since < HOUR) continue;
            const female = need === "toileting" && res.data.care.female_carers_only;
            const needed = need === "toileting" ? res.data.care.personal_care_staff : 1;
            const idleAll = people.filter((q) => {
              if (!isCareStaff(q) || !q.onMap || q.staff!.duty !== "on_shift") return false;
              if (female && q.gender !== "female") return false;
              const task = q.staff!.taskId ? world.tasks.get(q.staff!.taskId) : undefined;
              return !task || task.kind === "idle";
            });
            const idle = idleAll.length >= needed ? idleAll[0] : undefined;
            if (idle) v("need_unmet_staff_idle", `${key}:${since}`, `${r.name}'s ${need} at ${res.needs[need].toFixed(2)} for ${Math.round((t - since) / 60)} min while ${first(idle)} is ${idle.staff!.taskId ? world.tasks.get(idle.staff!.taskId)!.label.toLowerCase() : "free"}`);
          }
        }
      }

      // ------------------------------------------------ tasks
      const womanOn = people.some((q) => isCareStaff(q) && q.onMap && q.gender === "female" && q.staff!.duty === "on_shift");
      const carersOn = people.filter((q) => isCareStaff(q) && q.onMap && q.staff!.duty === "on_shift").length;
      const tod = t % 86400;
      const dayTime = tod >= 7 * HOUR && tod < 21.5 * HOUR;
      for (const task of world.tasks.values()) {
        if (task.request && task.startedT === null && t - task.createdT > 2 * HOUR) {
          const r = world.people.get(task.residentId!);
          v("request_unanswered_2h", `${task.residentId}:${task.id}`, `${task.label} waiting ${Math.round((t - task.createdT) / 60)} min${task.femaleOnly ? " (female carers only)" : ""}${task.staffNeeded === 2 ? " (two staff)" : ""}${r?.resident?.fall ? " (on the floor)" : ""}`);
        }
        if (dayTime && carersOn < 2 && task.staffNeeded === 2 && task.status === "open" && (task.kind === "care" || task.kind === "assist") && t - task.createdT > HOUR && world.mainCarer.status === "off" && world.float.status === "off") {
          v("lone_carer_two_person_due", `${task.residentId}:${task.id}`, `${task.label} waiting ${Math.round((t - task.createdT) / 60)} min with ${carersOn} carer on the wing and nobody sent for`);
        }
        if (task.femaleOnly && task.startedT === null && !womanOn && t - task.createdT > HOUR) v("no_woman_for_female_only", `${task.residentId}:${task.id}`, `${task.label} waiting ${Math.round((t - task.createdT) / 60)} min with no woman on shift on the wing`);
        if (task.residentId) {
          const r = world.people.get(task.residentId);
          if (!r?.onMap) v("task_for_absent_resident", `${task.residentId}:${task.id}`, `${task.label} (${task.kind}, ${task.status}) for ${r?.name ?? task.residentId}, who is ${r?.resident?.away ?? "gone"}`);
        }
        for (const id of task.assigned) {
          const q = world.people.get(id);
          if (!q) v("orphan_task", `${task.id}:${id}`, `${task.label} assigned to ${id}, who no longer exists`);
          else if (!task.members && task.kind !== "idle" && q.staff && q.staff.taskId !== task.id) v("orphan_task", `${task.id}:${id}`, `${task.label} (${task.status}) lists ${q.name}, who is on ${q.staff.taskId ?? "nothing"}`);
        }
        // An escort: the carer walks beside the resident, not on ahead.
        const escort = (task.kind === "care" && task.data.care === "escort") || (task.kind === "assist" && task.data.method === "escort");
        if (escort && task.status === "active" && task.startedT !== null && task.residentId) {
          const r = world.people.get(task.residentId);
          if (r?.move) {
            const near = Math.min(...task.assigned.map((id) => world.people.get(id)).filter((q): q is Person => !!q).map((q) => Math.hypot(q.x - r.x, q.y - r.y)));
            // Walking on alone: over 2 m from the carer and not closing the gap (not walking up to a carer waiting for them).
            // Allowing for 5-second ticks: one tick held at a busy door is a moment, not walking alone.
            const before = escortGap.get(task.id);
            const apart = before !== undefined && near > 2 && near >= before.gap - 0.01;
            const ticks = apart ? (before?.ticks ?? 0) + 1 : 0;
            escortGap.set(task.id, { gap: near, ticks });
            if (apart && (ticks >= 2 || near > 3)) v("escort_apart", `${r.id}:${task.id}`, `${r.name} walking (${task.label}) with the carer ${near.toFixed(1)} m away`);
          }
        }
        // Toast for someone on a soft, bite-sized diet (tea and toast for an early riser).
        if (task.kind === "care" && task.data.care === "tea" && task.data.toast === 1 && task.status === "active" && task.startedT !== null) {
          const r = world.people.get(task.residentId!);
          const diet = r?.resident?.data.nutrition.diet ?? "";
          if (/iddsi|soft/i.test(diet)) v("diet_texture", `${task.residentId}:toast:${dayIndex(t)}`, `${r!.name} (${diet}) given tea and toast`);
        }
        // Female-only personal care with a man.
        if (task.residentId && task.startedT !== null && task.status === "active") {
          const r = world.people.get(task.residentId);
          const personal = (task.kind === "care" && PERSONAL_CARE.has(String(task.data.care))) || (task.kind === "assist" && task.need === "toileting");
          if (r?.resident?.data.care.female_carers_only && personal) {
            const men = task.assigned.map((id) => world.people.get(id)!).filter((q) => q?.gender === "male" && Math.hypot(q.x - r.x, q.y - r.y) <= 2.5);
            if (men.length > 0) v("female_only_by_man", `${r.id}:${task.id}`, `${task.label} for ${r.name} (female carers only) with ${men.map((q) => q.name).join(", ")}`);
          }
        }
      }
      for (const p of people) {
        const s = p.staff;
        if (s?.taskId && !world.tasks.has(s.taskId)) v("orphan_task", `staff:${p.id}:${s.taskId}`, `${p.name} is on ${s.taskId}, which no longer exists`);
        const res = p.resident;
        if (res?.busyTaskId && !world.tasks.has(res.busyTaskId)) v("orphan_task", `busy:${p.id}:${res.busyTaskId}`, `${p.name} is busy with ${res.busyTaskId}, which no longer exists`);
      }
      for (const call of world.paramedics) if (!world.tasks.has(call.taskId)) v("orphan_task", `ambulance:${call.taskId}`, `an ambulance call for ${call.taskId}, which no longer exists`);
      for (const f of world.fallLog) {
        if (f.endT !== null) continue;
        const r = world.people.get(f.residentId);
        if (!r?.resident?.fall) v("orphan_task", `falllog:${f.residentId}:${f.t}`, `${r?.name ?? f.residentId}'s fall at ${f.t} never closed in the fall log (so every breach since is put down to it)`);
      }

      // ------------------------------------------------ staff and visitors
      for (const p of people) {
        // Visitors.
        if (p.visitor && p.onMap) {
          const room = p.roomId ? world.data.floorplan.rooms.find((x) => x.id === p.roomId) : undefined;
          if (room?.kind === "ensuite") v("visitor_in_ensuite", `${p.id}:${dayIndex(t)}`, `${p.name} in ${room.id} (visiting ${world.people.get(p.visitor.residentId)?.name})`);
          const r = world.people.get(p.visitor.residentId);
          if (!r?.onMap && p.visitor.phase !== "leaving" && t - (absentSince.get(r!.id) ?? t) > 5 * MIN) v("absent_resident_state", `visitor:${p.id}`, `${p.name} still here (${p.visitor.phase}) for ${r?.name}, who is ${r?.resident?.away}`);
        }
        const s = p.staff;
        if (!s) continue;
        // Sick staff.
        const inf = p.infection;
        if (inf?.symptomatic && !inf.recovered && p.onMap && (s.duty === "on_shift" || s.duty === "staying")) {
          const mins = (t - inf.symptomaticFromT) / 60;
          if (mins > 60) v("sick_staff_on_wing", `${p.id}:${inf.symptomaticFromT}`, `${p.name} still on the wing ${Math.round(mins)} min after ${inf.disease} symptoms began (${s.duty})`);
          const task = s.taskId ? world.tasks.get(s.taskId) : undefined;
          if (task && task.status === "active" && residentFacing(task) && mins > 5) v("sick_staff_giving_care", `${p.id}:${inf.symptomaticFromT}`, `${p.name}, with ${inf.disease} symptoms for ${Math.round(mins)} min, on ${task.label}`);
        }
        // Hours (the wing's own staff).
        if (p.kind === "staff") {
          if (p.onMap) {
            if (!onMapSince.has(p.id)) {
              const last = leftT.get(p.id);
              if (last !== undefined && t - last < 11 * HOUR) v("excessive_hours", `${p.id}:rest:${t}`, `${p.name} back after ${((t - last) / HOUR).toFixed(1)} h off`);
              onMapSince.set(p.id, t);
            }
            const since = onMapSince.get(p.id)!;
            if (t - since > 14 * HOUR) v("excessive_hours", `${p.id}:${since}`, `${p.name} on the wing for ${((t - since) / HOUR).toFixed(1)} h`);
          } else if (onMapSince.has(p.id)) {
            onMapSince.delete(p.id);
            leftT.set(p.id, t);
          }
        }
      }
      // Helpers from outside who have nothing left to do.
      const idleExt = (id: string, allowedMins: number, why: () => boolean) => {
        const q = world.people.get(id);
        if (!q?.onMap || !why()) {
          extSince.delete(id);
          return;
        }
        const since = extSince.get(id) ?? t;
        extSince.set(id, since);
        if (t - since > allowedMins * MIN) v("stuck_external", `${id}:${since}`, `${q.name} on the wing ${Math.round((t - since) / 60)} min with nothing to do`);
      };
      // The crew with nobody to take: no call, or standing still where no active fall or transfer needs them.
      idleExt(EXTERNALS.paramedics, 30, () => {
        const crew = world.people.get(EXTERNALS.paramedics)!;
        if (crew.staff!.duty === "leaving" || crew.move) return false;
        return ![...world.tasks.values()].some((task) => (task.kind === "fall" || task.kind === "hospital_transfer") && task.status === "active" && String(task.data.point) === crew.atPoint);
      });
      idleExt(EXTERNALS.rn, 120, () => !world.people.get(EXTERNALS.rn)!.staff!.taskId);
      const lorna = world.people.get(world.data.rota.night_float.id)!;
      if (lorna.onMap) {
        const since = extSince.get(lorna.id) ?? t;
        extSince.set(lorna.id, since);
        if (t - since > 240 * MIN) v("float_overstay", `${lorna.id}:${since}`, `${lorna.name} on the wing for ${Math.round((t - since) / 60)} min (since ${Math.round(((since % 86400) / 3600) * 100) / 100} h)`);
      } else extSince.delete(lorna.id);

      // ------------------------------------------------ places
      const seats = new Map<string, string>();
      const beds = new Map<string, string>();
      for (const p of people) {
        if (!p.onMap) continue;
        const cell = cellAt(world.grid, p.x, p.y);
        const inBed = !!p.resident?.inBed && p.atPoint === p.resident.data.room;
        if (!inBed && !world.grid.walkable[cell]) v("off_walkable", p.id, `${p.name} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}), not walkable (${world.grid.roomOf[cell] ?? "outside"})`);
        if (!p.move && p.roomId && world.grid.roomOf[cell] && world.grid.roomOf[cell] !== p.roomId) v("off_walkable", `${p.id}:room`, `${p.name} in ${p.roomId} by the log but standing in ${world.grid.roomOf[cell]}`);
        if (inBed) {
          const other = beds.get(p.resident!.data.room);
          if (other) v("shared_seat", p.resident!.data.room, `${other} and ${p.id} both in ${p.resident!.data.room}`);
          beds.set(p.resident!.data.room, p.id);
        }
        if (!p.move && (p.posture === "sitting" || p.posture === "dozing") && p.atPoint) {
          const pt = world.points.get(p.atPoint);
          const exact = !!pt && pt.x === p.x && pt.y === p.y;
          if (exact) {
            const other = seats.get(p.atPoint);
            if (other) v("shared_seat", p.atPoint, `${other} and ${p.id} both sitting on ${p.atPoint}`);
            seats.set(p.atPoint, p.id);
          }
        }
      }
      return out;
    },
  };
}

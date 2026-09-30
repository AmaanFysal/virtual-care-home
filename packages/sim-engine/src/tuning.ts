// Tuning rules (docs/12 "Tuning debt"): narrow scheduling rules added to keep calm weeks free of
// service breaches. The tuning review (sub-milestone e, 2026-09-30, docs/12) kept these: removing
// any one pushes a calm week over 2 breaches (on seeds 1-8 or 9-16, or with Kamala in), clearly
// harms short-staffed days, or leaves residents' hunger, thirst or toileting needs unmet in the
// audit; the female-only rules protect a care requirement. Each
// can be switched off on its own (`createSim({ tuning: { rule: false } })`) so the review can be
// run again (`scripts/tuning-review.ts`). All are on by default.

import type { World } from "./state.js";

export const TUNING_RULES = {
  pressing_turns: "Turns are pressing 25 minutes ahead and created 30 minutes ahead (before: 15 and 20)",
  sole_partner: "A pressing reserved turn's only possible partner keeps to short work",
  turn_team: "Nobody starts long care that a two-person turn they're needed for would fall due during, and the only people free for a pressing turn keep to short work (general form of sole_partner; tuning review 2026-09-30)",
  pressing_first: "Pressing reservations are made before any other matching",
  evening_crunch: "Turns due 20:00 to 21:30 are moved to 19:45 (kept for short-staffed days)",
  float_planning: "(Kept for short-staffed days.) The floating carer plans back-to-back turns to start by their due times, and turns due 06:45 to 07:30 for 06:45",
  lounge_break_recall: "Lounge: an urgent look-in calls someone back from a break",
  briefing_hold: "The briefing starts only when both are free; the first free keeps to short work for up to 10 minutes (kept for short-staffed mornings)",
  tea_deadline: "Tea on waking has a hard deadline (kept on the audit's evidence)",
  tea_with_tablets: "The nurse gives a drink with the tablets to anyone who hasn't had tea (kept on the audit's evidence)",
  breakfast_first: "Breakfast offered first holds that resident's morning care until they've eaten (kept on the audit's evidence)",
  female_only_bonus: "Female-only care scores +25 for women (protects a care requirement; kept on the audit's evidence)",
  only_woman_two_person: "The only woman on shift scores -30 for two-person work while female-only care is pending (as above)",
  break_waits_only_woman: "A break waits while female-only work is waiting and they're the only woman on (as above)",
  breakfast_boost: "Breakfast gets the same time-awake boost as morning care (kept on the audit's evidence: without it Arthur is hungry most mornings)",
} as const;

export type TuningRule = keyof typeof TUNING_RULES;
export type Tuning = Record<TuningRule, boolean>;

export function defaultTuning(overrides: Partial<Tuning> = {}): Tuning {
  const all = Object.fromEntries(Object.keys(TUNING_RULES).map((k) => [k, true])) as Tuning;
  return { ...all, ...overrides };
}

/** Whether a tuning rule is on for this run. */
export function tuned(world: World, rule: TuningRule): boolean {
  return world.tuning[rule];
}

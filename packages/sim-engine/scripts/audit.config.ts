// Thresholds for the behaviour audit (`sim --audit`). Tune them here; the audit reads nothing else.
// These are what we expect of a believable wing, not engine rules: the engine never reads this file.

export const AUDIT = {
  /** Care days run from this time to the same time next day: the engine's daily reset (morning care, meals). */
  careDayStartsAt: "04:00",

  needs: {
    /** "High": time spent above this is reported per need. */
    highAt: 0.7,
    /** Flag a need above this for longer than `flagAfterMins` in one go. */
    flagAbove: 0.8,
    flagAfterMins: 20,
  },

  morning: {
    /** A night's sleep ends with the last wake-up in this window. */
    wakeWindow: ["04:00", "11:00"],
    /** Flag a first drink this long after waking. */
    firstDrinkWithinMins: 15,
    /** Flag breakfast this long after waking. */
    breakfastWithinMins: 60,
    /** A thirst drop this big in one minute counts as a drink. */
    drinkDrop: 0.15,
  },

  meals: {
    /** Serving windows, mirrored from care.ts, to tell when a meal was due. */
    windows: { breakfast: ["07:30", "10:30"], lunch: ["12:15", "13:30"], supper: ["17:30", "18:45"] },
  },

  drinks: {
    rounds: { mid_morning: "10:30", afternoon_tea: "15:00", late_drink: "20:00" },
    /** Flag a drinks round that starts this long after its time. */
    startLateMins: 30,
    /** Flag a drink left by the bed that is still not drunk this long later. */
    leftUndrunkMins: 120,
  },

  inBed: {
    /** Anyone not bed-bound who is in bed between these times is flagged, unless there's a reason (a fall, away). */
    dayFrom: "10:00",
    dayUntil: "19:00",
    /** Ignore spells in bed shorter than this (a sit on the bed after the WC). */
    minMins: 5,
  },

  requests: {
    /** After help, the need should be below this; otherwise it closed without real relief. */
    relievedBelow: 0.5,
  },

  staff: {
    /** Flag someone free or on an idle activity for this long while an awake resident has a need above `needAbove`. */
    idleWhileNeedMins: 20,
    needAbove: 0.7,
    /** Needs staff can act on (fatigue isn't). */
    actionableNeeds: ["hunger", "thirst", "toileting", "social"],
    /** Needs that don't count for a resident (Dennis is on end-of-life comfort care: no appetite). */
    idleNeedExempt: { res_dennis: ["hunger"] } as Record<string, readonly string[]>,
    /** Flag anyone walking more than this share of their shift. */
    walkingShare: 0.25,
  },

  careOrder: {
    /** Morning care out of wake order is flagged only if the gap between the two wake times is at least this. */
    toleranceMins: 15,
  },

  movement: {
    /** Flag anyone who stays put in the corridor or a doorway this long. */
    stationaryMins: 10,
    /** Two people this close, both standing still, share a spot... */
    samePlaceMetres: 0.3,
    /** ...if it lasts at least this long. */
    samePlaceMins: 2,
    /** Oscillation: this many back-and-forth cell reversals within the window. */
    reversals: 6,
    reversalWindowMins: 5,
    /** "Bed area": within this distance of the bed (the bedside chair is about 1.9 m away). */
    bedAreaMetres: 2.5,
    /** Trips to the en-suite WC don't count as leaving the bed area. */
    ignoreWcTrips: true,
    /** Residents for whom staying in the bed area all day is expected. */
    bedAreaExempt: ["res_dennis", "res_raj"],
  },

  meds: {
    /** Flag a medication round that starts this long after its time. */
    roundStartLateMins: 15,
  },
} as const;

export type AuditConfig = typeof AUDIT;

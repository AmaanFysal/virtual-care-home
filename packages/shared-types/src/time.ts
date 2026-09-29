// Sim-time helpers. Sim time is integer seconds since Monday 2026-11-02 00:00 (docs/03).
// Pure arithmetic: no Date, so the engine can use these too.

import { WEEKDAYS, type ClockTime, type Weekday } from "./data.js";

export const SECONDS_PER_DAY = 86_400;
export const TICK_SECONDS = 5;
/** Default run start: Tuesday 2026-11-03 06:00. */
export const DEFAULT_START_T = SECONDS_PER_DAY + 6 * 3600;

export function dayIndex(t: number): number {
  return Math.floor(t / SECONDS_PER_DAY);
}

export function weekday(t: number): Weekday {
  return WEEKDAYS[dayIndex(t) % 7]!;
}

/** Seconds since midnight. */
export function timeOfDay(t: number): number {
  return ((t % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

/** "07:30" → 27000 seconds since midnight. */
export function clockToSeconds(clock: ClockTime): number {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!match) throw new Error(`Bad clock time "${clock}"`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Bad clock time "${clock}"`);
  return hours * 3600 + minutes * 60;
}

const MONTHS = [
  { name: "Nov", days: 30 },
  { name: "Dec", days: 31 },
  { name: "Jan", days: 31 },
  { name: "Feb", days: 28 },
] as const;

/** "Tue 03 Nov 07:30" (with ":05" seconds when `withSeconds`). Valid until end of Feb 2027. */
export function formatSimTime(t: number, withSeconds = false): string {
  let day = dayIndex(t) + 2; // the epoch is 2 November
  let month = 0;
  while (month < MONTHS.length - 1 && day > MONTHS[month]!.days) {
    day -= MONTHS[month]!.days;
    month += 1;
  }
  const secs = timeOfDay(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hhmm = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}`;
  const clock = withSeconds ? `${hhmm}:${pad(secs % 60)}` : hhmm;
  return `${weekday(t)} ${pad(day)} ${MONTHS[month]!.name} ${clock}`;
}

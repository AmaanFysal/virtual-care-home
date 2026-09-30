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

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The calendar date of a sim time (the epoch is Mon 2 Nov 2026). Month is 1..12. Any year. */
export function simDate(t: number): { year: number; month: number; day: number } {
  let rest = dayIndex(t) + 1; // days after 1 November 2026
  let year = 2026;
  let month = 11;
  while (rest >= daysInMonth(year, month)) {
    rest -= daysInMonth(year, month);
    month += 1;
    if (month > 12) (month = 1), (year += 1);
  }
  return { year, month, day: rest + 1 };
}

/** "Tue 03 Nov 07:30" (with ":05" seconds when `withSeconds`). */
export function formatSimTime(t: number, withSeconds = false): string {
  const { month, day } = simDate(t);
  const secs = timeOfDay(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hhmm = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}`;
  const clock = withSeconds ? `${hhmm}:${pad(secs % 60)}` : hhmm;
  return `${weekday(t)} ${pad(day)} ${MONTH_NAMES[month - 1]} ${clock}`;
}

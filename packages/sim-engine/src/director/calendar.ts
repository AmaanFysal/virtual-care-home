// Birthdays and festivals (docs/10, sub-milestone d): which residents celebrate what on a given
// day, from each card's date of birth and faith and the festivals in data/director.json. Pure:
// the director turns these into `celebration` inputs.

import { SECONDS_PER_DAY, simDate, type CelebrationKind, type CelebrationsConfig } from "@vch/shared-types";

export interface CelebrationPlan {
  kind: CelebrationKind;
  name: string;
  residentIds: string[];
}

/** Western (Gregorian) Easter Sunday: the anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const pad = (n: number) => String(n).padStart(2, "0");
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Whether a festival falls on this date. */
function festivalOn(date: string | string[], year: number, month: number, day: number): boolean {
  if (Array.isArray(date)) return date.includes(`${year}-${pad(month)}-${pad(day)}`);
  if (date === "easter") {
    const e = easterSunday(year);
    return e.month === month && e.day === day;
  }
  return date === `${pad(month)}-${pad(day)}`;
}

/** The faith groups a card's `faith` belongs to (by the words listed for each group). */
export function faithGroups(config: CelebrationsConfig, faith: string): string[] {
  const f = faith.toLowerCase();
  return Object.entries(config.faiths)
    .filter(([, words]) => words.some((w) => f.includes(w)))
    .map(([group]) => group)
    .sort();
}

/**
 * The celebrations on day `day` for these residents: a birthday for each whose date of birth
 * falls today (29 February on the 28th in other years), and each festival with the residents it's
 * for. Residents in `ids` order; birthdays first, then festivals in the order listed.
 */
export function celebrationsOn(config: CelebrationsConfig, day: number, residents: { id: string; name: string; dob: string; faith: string }[]): CelebrationPlan[] {
  const { year, month, day: date } = simDate(day * SECONDS_PER_DAY);
  const out: CelebrationPlan[] = [];
  for (const r of residents) {
    const [, m, d] = r.dob.split("-").map(Number) as [number, number, number];
    const bday = m === 2 && d === 29 && !isLeap(year) ? 28 : d;
    if (m === month && bday === date) out.push({ kind: "birthday", name: `${r.name.split(" ")[0]}'s birthday`, residentIds: [r.id] });
  }
  for (const f of config.festivals) {
    if (!festivalOn(f.date, year, month, date)) continue;
    const ids = residents.filter((r) => f.for === "any" || faithGroups(config, r.faith).some((g) => f.for.includes(g))).map((r) => r.id);
    if (ids.length > 0) out.push({ kind: "festival", name: f.name, residentIds: ids });
  }
  return out;
}

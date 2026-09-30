// Per-day report for director runs (docs/10, docs/11): each calendar day's type, what the director
// did (applied, held back by a pacing cap, or no longer applicable), cover for absences, and the
// service breaches with their causes. Used by `sim --report` and `sim --audit`.

import { SECONDS_PER_DAY, dayIndex, formatSimTime, type AnySimEvent } from "@vch/shared-types";

export interface DayRow {
  day: number;
  dayType: string;
  falls: { minor: number; serious: number };
  sick: number;
  noShows: number;
  covers: Record<"bank" | "agency" | "stay_on" | "main_building" | "none", number>;
  suppressed: string[];
  skipped: string[];
  breaches: number;
  hard: number;
  cases: number;
  lines: string[];
}

export interface DayTotals {
  days: number;
  byType: Record<string, number>;
  downgraded: number;
  falls: { minor: number; serious: number };
  sick: number;
  noShows: number;
  covers: DayRow["covers"];
  suppressed: Map<string, number>;
  skipped: Map<string, number>;
  breaches: { calm: number; eventful: number; byCause: Map<string, number> };
  hard: number;
  /** Symptomatic cases by disease, exposures by route, outbreaks (disease, days), visits cancelled. */
  infection: { cases: Map<string, number>; routes: Map<string, number>; outbreaks: { disease: string; days: number; cases: number }[]; open: number; cancelledVisits: number; wentHome: number };
}

export function emptyTotals(): DayTotals {
  return {
    days: 0,
    byType: {},
    downgraded: 0,
    falls: { minor: 0, serious: 0 },
    sick: 0,
    noShows: 0,
    covers: { bank: 0, agency: 0, stay_on: 0, main_building: 0, none: 0 },
    suppressed: new Map(),
    skipped: new Map(),
    breaches: { calm: 0, eventful: 0, byCause: new Map() },
    hard: 0,
    infection: { cases: new Map(), routes: new Map(), outbreaks: [], open: 0, cancelledVisits: 0, wentHome: 0 },
  };
}

const hhmm = (t: number) => formatSimTime(t).slice(-5);
const first = (id: string, names: Map<string, string>) => (names.get(id) ?? id).split(" ")[0];

/** Builds the rows for one run's events and adds them to `totals`. */
export function dayReport(events: AnySimEvent[], names: Map<string, string>, totals: DayTotals = emptyTotals()): { rows: DayRow[]; totals: DayTotals } {
  const rows = new Map<number, DayRow>();
  const row = (t: number): DayRow => {
    const day = dayIndex(t);
    let r = rows.get(day);
    if (!r) {
      r = { day, dayType: "-", falls: { minor: 0, serious: 0 }, sick: 0, noShows: 0, covers: { bank: 0, agency: 0, stay_on: 0, main_building: 0, none: 0 }, suppressed: [], skipped: [], breaches: 0, hard: 0, cases: 0, lines: [] };
      rows.set(day, r);
    }
    return r;
  };
  for (const e of events) {
    const r = row(e.t);
    const at = hhmm(e.t);
    switch (e.type) {
      case "director.day_planned":
        r.dayType = e.payload.dayType + (e.payload.downgradedFrom ? ` (drawn ${e.payload.downgradedFrom}, capped)` : "");
        if (e.payload.downgradedFrom) totals.downgraded += 1;
        break;
      case "director.suppressed": {
        const p = e.payload.params as Record<string, string>;
        const what = `${e.payload.inputType} ${Object.values(p).map((v) => first(v, names)).join(" ")} at ${hhmm(e.payload.applyT)}`;
        r.suppressed.push(`${what} (${e.payload.reason})`);
        r.lines.push(`    held back: ${what}: ${e.payload.reason}`);
        const key = `${e.payload.inputType}: ${e.payload.reason}`;
        totals.suppressed.set(key, (totals.suppressed.get(key) ?? 0) + 1);
        break;
      }
      case "input.skipped": {
        r.skipped.push(`${e.payload.inputType}: ${e.payload.reason}`);
        r.lines.push(`    ${at}  skipped ${e.payload.inputType}: ${e.payload.reason}`);
        const key = `${e.payload.inputType}: ${e.payload.reason}`;
        totals.skipped.set(key, (totals.skipped.get(key) ?? 0) + 1);
        break;
      }
      case "resident.fell":
        r.falls[e.payload.severity] += 1;
        r.lines.push(`    ${at}  ${e.payload.severity} fall: ${first(e.payload.residentId, names)} (${e.source})`);
        break;
      case "infection.exposed": {
        const how = e.payload.route === "introduced" ? "brought in" : `${e.payload.route} from ${first(e.payload.sourceId ?? "", names)}`;
        r.lines.push(`    ${at}  ${first(e.payload.personId, names)} caught ${e.payload.disease} (${how}, ${e.payload.roomId ?? "off the wing"})`);
        totals.infection.routes.set(e.payload.route, (totals.infection.routes.get(e.payload.route) ?? 0) + 1);
        break;
      }
      case "infection.symptomatic":
        r.cases += 1;
        r.lines.push(`    ${at}  ${first(e.payload.personId, names)} ill with ${e.payload.disease}${e.payload.personId.startsWith("res_") ? ", isolated in their room" : ""}`);
        totals.infection.cases.set(e.payload.disease, (totals.infection.cases.get(e.payload.disease) ?? 0) + 1);
        break;
      case "outbreak.declared":
        r.lines.push(`    ${at}  ${e.payload.disease} OUTBREAK declared (${e.payload.cases.map((c) => first(c, names)).join(", ")}): Lounge closed, essential visits only`);
        totals.infection.open += 1;
        break;
      case "outbreak.over":
        r.lines.push(`    ${at}  ${e.payload.disease} outbreak over after ${e.payload.days} days, ${e.payload.cases.length} cases`);
        totals.infection.open -= 1;
        totals.infection.outbreaks.push({ disease: e.payload.disease, days: e.payload.days, cases: e.payload.cases.length });
        break;
      case "visit.cancelled":
        totals.infection.cancelledVisits += 1;
        break;
      case "resident.conveyed_to_hospital":
        r.lines.push(`    ${at}  ${first(e.payload.residentId, names)} taken to hospital`);
        break;
      case "resident.returned_from_hospital":
        r.lines.push(`    ${at}  ${first(e.payload.residentId, names)} back from hospital after ${e.payload.daysAway} days`);
        break;
      case "med_round.no_giver":
        r.lines.push(`    ${at}  ${e.payload.round} round: nobody meds-trained on the wing, on-call RN called`);
        break;
      case "staff.absent":
        if (e.payload.reason === "sick") r.sick += 1;
        else r.noShows += 1;
        if (e.payload.reason === "went_home_sick") totals.infection.wentHome += 1;
        r.lines.push(`    ${at}  ${e.payload.name.split(" ")[0]} ${e.payload.reason === "sick" ? "off sick" : e.payload.reason === "went_home_sick" ? "went home ill" : "didn't turn up"} for ${e.payload.slot} at ${hhmm(e.payload.shiftStartT)} (${e.source})`);
        break;
      case "rota.cover_booked":
        r.covers[e.payload.cover] += 1;
        r.lines.push(`    ${at}    cover: ${e.payload.cover} ${names.get(e.payload.staffId) ?? e.payload.staffId}${e.payload.cover === "stay_on" ? ` until ${hhmm(e.payload.untilT ?? e.payload.arriveT)}` : `, arriving ${hhmm(e.payload.arriveT)}`}`);
        break;
      case "rota.no_cover":
        r.covers.none += 1;
        r.lines.push(`    ${at}    no cover: ${e.payload.reason}; ${e.payload.slot} runs short`);
        break;
      case "sla.breached":
        r.breaches += 1;
        r.lines.push(`    ${at}  breach ${e.payload.target}: ${e.payload.details} [${e.payload.cause}]`);
        totals.breaches.byCause.set(`${e.payload.target}, ${causeKind(e.payload.cause)}`, (totals.breaches.byCause.get(`${e.payload.target}, ${causeKind(e.payload.cause)}`) ?? 0) + 1);
        break;
      case "invariant.violated":
        r.hard += 1;
        r.lines.push(`    ${at}  HARD ${e.payload.rule}: ${e.payload.details}`);
        break;
    }
  }
  const out = [...rows.values()].sort((a, b) => a.day - b.day);
  for (const r of out) {
    totals.days += 1;
    totals.byType[r.dayType.split(" ")[0]!] = (totals.byType[r.dayType.split(" ")[0]!] ?? 0) + 1;
    totals.falls.minor += r.falls.minor;
    totals.falls.serious += r.falls.serious;
    totals.sick += r.sick;
    totals.noShows += r.noShows;
    for (const k of Object.keys(r.covers) as (keyof DayRow["covers"])[]) totals.covers[k] += r.covers[k];
    const eventful = r.falls.minor + r.falls.serious + r.sick + r.noShows + r.cases > 0 || r.lines.some((l) => / caught | OUTBREAK | outbreak over /.test(l));
    if (eventful) totals.breaches.eventful += r.breaches;
    else totals.breaches.calm += r.breaches;
    totals.hard += r.hard;
  }
  return { rows: out, totals };
}

/** The cause without names and times, for grouping. */
function causeKind(cause: string): string {
  return cause
    .split("; ")
    .map((c) => (c.startsWith("short-staffed") ? "short-staffed" : c.startsWith("no emergency") ? "no emergency" : c.replace(/ \(.*$/, "")))
    .filter((c, i, all) => all.indexOf(c) === i)
    .join(" + ");
}

export function dayLines(rows: DayRow[]): string[] {
  const L: string[] = [];
  for (const r of rows) {
    const label = formatSimTime(r.day * SECONDS_PER_DAY).slice(0, 10);
    const falls = r.falls.minor + r.falls.serious;
    const summary = [
      falls ? `${falls} fall${falls > 1 ? "s" : ""}${r.falls.serious ? ` (${r.falls.serious} serious)` : ""}` : null,
      r.sick ? `${r.sick} sick` : null,
      r.cases ? `${r.cases} ill (infection)` : null,
      r.noShows ? `${r.noShows} no-show` : null,
      r.suppressed.length ? `${r.suppressed.length} held back` : null,
      `${r.breaches} breach${r.breaches === 1 ? "" : "es"}`,
      r.hard ? `${r.hard} HARD` : null,
    ].filter(Boolean);
    L.push(`  ${label}  ${r.dayType.padEnd(10)} ${summary.join(", ")}`);
    L.push(...r.lines);
  }
  return L;
}

export function totalsLines(t: DayTotals, weeks: number): string[] {
  const L: string[] = [];
  L.push(`  days: ${t.days} (${Object.entries(t.byType).map(([k, v]) => `${k} ${v} (${((100 * v) / t.days).toFixed(0)}%)`).join(", ")}); hard days capped to busy: ${t.downgraded}`);
  L.push(`  falls: ${t.falls.minor + t.falls.serious} (${t.falls.minor} minor, ${t.falls.serious} serious) = ${((t.falls.minor + t.falls.serious) / weeks).toFixed(2)} a week`);
  L.push(`  sick calls: ${t.sick} = ${(t.sick / weeks).toFixed(2)} a week; agency no-shows: ${t.noShows}`);
  L.push(`  cover: bank ${t.covers.bank}, agency ${t.covers.agency}, main building ${t.covers.main_building} (late carer bridging ${t.covers.stay_on}), none ${t.covers.none}`);
  L.push(`  held back by pacing caps: ${[...t.suppressed].map(([k, v]) => `${k} x${v}`).join("; ") || "none"}`);
  L.push(`  skipped when due: ${[...t.skipped].map(([k, v]) => `${k} x${v}`).join("; ") || "none"}`);
  L.push(`  service breaches: ${t.breaches.calm + t.breaches.eventful} (${t.breaches.calm} on days with no director event, ${t.breaches.eventful} on days with one)`);
  for (const [k, v] of [...t.breaches.byCause].sort((a, b) => b[1] - a[1])) L.push(`    ${String(v).padStart(4)}  ${k}`);
  const inf = t.infection;
  L.push(`  infection cases (ill): ${[...inf.cases].map(([k, v]) => `${k} ${v}`).join(", ") || "none"}; caught by route: ${[...inf.routes].map(([k, v]) => `${k} ${v}`).join(", ") || "none"}; staff sent home ill: ${inf.wentHome}`);
  L.push(`  outbreaks: ${inf.outbreaks.length} over${inf.open ? `, ${inf.open} still on at the end` : ""}${inf.outbreaks.map((o) => `; ${o.disease} ${o.days} days, ${o.cases} cases`).join("")}; visits cancelled: ${inf.cancelledVisits}`);
  L.push(`  hard violations: ${t.hard}${t.hard ? "  <-- MUST BE ZERO" : ""}`);
  return L;
}

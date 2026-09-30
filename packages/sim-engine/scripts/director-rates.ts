// Realised director rates against the base rates (docs/10 verification). Runs only the director's
// daily planner (no bodies) over many years per seed, with the rota's weekly roster and all six
// residents on the wing, and prints what the pacing caps hold back.
//   pnpm --filter @vch/sim-engine director-rates [--years 200] [--seeds 1-8]

import { parseArgs } from "node:util";
import { AGENCY, SECONDS_PER_DAY, WEEKDAYS, clockToSeconds, simDate, type DayType, type ShiftName } from "@vch/shared-types";
import { createRng, planRandomDay, residentRisk, weekOffShare, type PlanMemory, type RosterEntry } from "../src/index.js";
import { loadDirectorConfig, loadWorldData } from "../tools/load-data.js";

const { values } = parseArgs({ options: { years: { type: "string", default: "200" }, seeds: { type: "string", default: "1-8" } } });
const data = loadWorldData();
const config = loadDirectorConfig();
const residents = () => data.residents.map(residentRisk); // fresh each day (the planner marks who's busy)
const propensity = new Map(data.staff.map((s) => [s.id, s.contract.sickness_propensity]));
const FIRST_DAY = 1; // Tue 3 Nov 2026, as in a normal run
// Lead visitors, for their missed weeks (sub-milestone d); the regular ones are counted.
const visitors = data.visitors.filter((v) => !v.accompanies).map((v) => ({ id: v.id, reliability: v.visit_pattern.reliability }));
const regular = visitors.filter((v) => v.reliability >= config.visitors.regular_from_reliability);

function roster(day: number): RosterEntry[] {
  const r = data.rota.week[WEEKDAYS[day % 7]!];
  const slots: [ShiftName, string, string][] = [
    ["early", "early.lead", r.early.lead],
    ["early", "early.ca", r.early.ca],
    ["rn_day", "rn_day.nurse", r.rn_day.nurse],
    ["late", "late.lead", r.late.lead],
    ["late", "late.ca", r.late.ca],
    ["night", "night.carer", r.night.carer],
  ];
  return slots.map(([shift, slot, who]) => {
    const times = data.rota.shifts[shift];
    const startT = day * SECONDS_PER_DAY + clockToSeconds(times.start);
    let endT = day * SECONDS_PER_DAY + clockToSeconds(times.end);
    if (endT <= startT) endT += SECONDS_PER_DAY;
    return { personId: who, slot, shift, startT, endT, agency: who === AGENCY, propensity: propensity.get(who) ?? 0 };
  });
}

const [from, to] = values.seeds!.split("-").map(Number);
const years = Number(values.years);
const days = Math.round(years * 365.25);
const count = { days: 0, types: { ordinary: 0, busy: 0, hard: 0 } as Record<DayType, number>, downgraded: 0, minor: 0, serious: 0, sick: 0, noShow: 0, intro: { norovirus: 0, flu: 0 } as Record<string, number>, illnessSevere: 0, illnessMild: 0, endOfLife: 0, weeksOff: 0, weeksOffByCause: {} as Record<string, number>, weeksOffByMonth: new Array<number>(13).fill(0) };
const suppressed = new Map<string, number>();
let expectedSick = 0;
let expectedNoShow = 0;
for (let seed = from!; seed <= (to ?? from)!; seed++) {
  const rng = createRng(`${seed}/director`);
  const visitorRng = createRng(`${seed}/visitor_weeks`);
  const memory: PlanMemory = { dayTypes: new Map(), majorTs: [] };
  for (let day = FIRST_DAY; day < FIRST_DAY + days; day++) {
    const list = roster(day);
    const winter = config.absence.winter_months.includes(simDate(day * SECONDS_PER_DAY).month) ? config.absence.winter_factor : 1;
    for (const a of list) if (config.absence.slots.includes(a.slot)) a.agency ? (expectedNoShow += config.absence.agency_no_show) : (expectedSick += a.propensity * winter);
    const plan = planRandomDay(config, rng, memory, day, day * SECONDS_PER_DAY - 1, list, residents(), { visitors, visitorRng });
    memory.dayTypes.set(day, plan.dayType);
    memory.dayTypes.delete(day - 8);
    memory.majorTs = memory.majorTs.filter((t) => t > (day - 7) * SECONDS_PER_DAY);
    count.days += 1;
    count.types[plan.dayType] += 1;
    if (plan.downgradedFrom) count.downgraded += 1;
    for (const e of plan.planned) {
      if (e.type === "inject_fall") (e.params as { severity: string }).severity === "serious" ? count.serious++ : count.minor++;
      if (e.type === "staff_sick") count.sick += 1;
      if (e.type === "shift_no_show") count.noShow += 1;
      if (e.type === "infection_case") count.intro[(e.params as { disease: string }).disease]! += 1;
      if (e.type === "resident_illness") (e.params as { severity: string }).severity === "severe" ? count.illnessSevere++ : count.illnessMild++;
      if (e.type === "end_of_life_start") count.endOfLife += 1;
      if (e.type === "visitor_week_off") {
        const cause = (e.params as { cause: string }).cause;
        count.weeksOff += 1;
        count.weeksOffByCause[cause] = (count.weeksOffByCause[cause] ?? 0) + 1;
        count.weeksOffByMonth[simDate(day * SECONDS_PER_DAY).month]! += 1;
      }
    }
    for (const s of plan.suppressed) {
      const key = `${s.event.type}${s.event.type === "inject_fall" ? ` (${(s.event.params as { severity: string }).severity})` : ""}: ${s.reason}`;
      suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
    }
  }
}

const seedYears = count.days / 365.25;
const meanRate = (Object.keys(config.day_types) as DayType[]).reduce((s, k) => s + config.day_types[k].p * config.day_types[k].rate, 0);
const pct = (n: number) => `${((100 * n) / count.days).toFixed(1)}%`;
const line = (label: string, realised: number, base: number) =>
  console.log(`  ${label.padEnd(28)} ${realised.toFixed(2).padStart(7)} a year   base ${base.toFixed(2).padStart(6)}   ${(((realised - base) / base) * 100).toFixed(1).padStart(6)}%`);
console.log(`Director planner only, seeds ${values.seeds}, ${years} years each (${count.days} days); mean day-type rate ${meanRate.toFixed(3)}`);
console.log(`  day types: ordinary ${pct(count.types.ordinary)}, busy ${pct(count.types.busy)}, hard ${pct(count.types.hard)} (target 70/22/8); hard days capped to busy: ${count.downgraded} (${pct(count.downgraded)})`);
const wingFalls = config.falls.per_resident_year * data.residents.length;
line("falls (all)", (count.minor + count.serious) / seedYears, wingFalls);
line("falls (serious)", count.serious / seedYears, wingFalls * config.falls.serious_share);
line("sick calls", count.sick / seedYears, expectedSick / seedYears);
line("agency no-shows", count.noShow / seedYears, expectedNoShow / seedYears);
const n = data.residents.length;
line("hospital admissions", (count.illnessSevere + count.serious) / seedYears, config.health.admissions_per_resident_year * n);
line("illness looked after at home", count.illnessMild / seedYears, ((config.health.admissions_per_resident_year - config.falls.per_resident_year * config.falls.serious_share) * n * (1 - config.health.illness.severe_share)) / config.health.illness.severe_share);
line("end of life (deaths)", count.endOfLife / seedYears, config.health.end_of_life.deaths_per_resident_year * n);
for (const disease of ["norovirus", "flu"] as const) {
  const d = config.infection.diseases[disease];
  line(`${disease} brought in`, count.intro[disease]! / seedYears, d.per_winter + d.per_summer);
}
line("visitors' weeks off", count.weeksOff / seedYears, regular.reduce((s, v) => s + weekOffShare(config, v.reliability) * 52, 0));
console.log(`    ${regular.length} regular visitors; by cause: ${Object.entries(count.weeksOffByCause).sort().map(([k, v]) => `${k} ${((100 * v) / count.weeksOff).toFixed(0)}%`).join(", ")}`);
console.log(`    by month: ${count.weeksOffByMonth.slice(1).map((v, i) => `${i + 1}:${(v / seedYears).toFixed(1)}`).join(" ")}`);
console.log("  (base = the rate before day types, short staffing and caps; introductions here ignore outbreaks' quiet periods)");
console.log("Held back by the pacing caps:");
for (const [k, n] of [...suppressed].sort((a, b) => b[1] - a[1])) console.log(`  ${(n / seedYears).toFixed(3).padStart(7)} a year  ${k}`);
if (suppressed.size === 0) console.log("  nothing");

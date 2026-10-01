// Prints the world description (v1.0-testbed) at a moment of a run, as JSON: what external models read.
//   pnpm --filter @vch/sim-engine describe --seed 1 --at "Wed 07:40" [--room Room5] [--start 2027-05-04]
// --at is the first such time at or after the start ("07:40" alone means the first 07:40);
// --start begins the run at 06:00 on that date, so the weather is that season's.

import { parseArgs } from "node:util";
import { DEFAULT_START_T, SECONDS_PER_DAY, TICK_SECONDS, WEEKDAYS, clockToSeconds, dayIndex, simTimeAt, weekday, type Weekday } from "@vch/shared-types";
import { createSim } from "../src/index.js";
import { loadAdmissions, loadWorldData } from "../tools/load-data.js";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    at: { type: "string", default: "07:40" },
    room: { type: "string" },
    start: { type: "string" },
  },
});

const startT = values.start ? simTimeAt(values.start) : DEFAULT_START_T;
const [first, second] = values.at!.split(" ");
const day = second ? (first as Weekday) : null;
if (day && !WEEKDAYS.includes(day)) throw new Error(`--at "${values.at}": the day must be one of ${WEEKDAYS.join(", ")}`);
const clock = clockToSeconds(second ?? first!);
let at = dayIndex(startT) * SECONDS_PER_DAY + clock;
while (at < startT || (day && weekday(at) !== day)) at += SECONDS_PER_DAY;

const sim = createSim({ seed: values.seed!, data: loadWorldData(), admissions: loadAdmissions(), startT });
for (let t = startT; t < at; t += TICK_SECONDS) sim.step();
const out = values.room ? sim.describeRoom(values.room) : sim.describe();
if (!out) throw new Error(`Unknown room "${values.room}"`);
console.log(JSON.stringify(out, null, 2));

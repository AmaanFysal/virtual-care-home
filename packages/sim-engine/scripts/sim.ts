// Headless run: prints the event log to the terminal.
//   pnpm --filter @vch/sim-engine sim -- --seed 1 --hours 4 [--type shift.] [--at 07:00] [--fall res_peggy@06:40]

import { parseArgs } from "node:util";
import { DEFAULT_START_T, clockToSeconds, dayIndex, formatSimTime, type AnySimEvent } from "@vch/shared-types";
import { createSim } from "../src/index.js";
import { loadWorldData } from "../tools/load-data.js";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    hours: { type: "string", default: "4" },
    type: { type: "string" },
    fall: { type: "string" },
    positions: { type: "boolean", default: false },
  },
});

const sim = createSim({ seed: values.seed!, data: loadWorldData() });
if (values.fall) {
  const [residentId, at] = values.fall.split("@");
  const target = dayIndex(DEFAULT_START_T) * 86400 + clockToSeconds(at!);
  const applyT = target > DEFAULT_START_T ? target : target + 86400;
  sim.enqueue({ seq: 1, applyTick: (applyT - DEFAULT_START_T) / 5, type: "inject_fall", payload: { residentId: residentId!, severity: "minor" }, source: "user" });
}

const describe = (e: AnySimEvent): string => {
  const p = e.payload as Record<string, unknown>;
  const detail = Object.entries(p)
    .filter(([k]) => k !== "staffId")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  return `${formatSimTime(e.t, true)}  ${e.source.padEnd(6)} ${e.type.padEnd(22)} ${e.actors.join(",").padEnd(14)} ${detail}`;
};

const ticks = Math.round((Number(values.hours) * 3600) / 5);
let count = 0;
for (let i = 0; i < ticks; i++) {
  for (const e of sim.step()) {
    count++;
    if (!values.type || e.type.startsWith(values.type)) console.log(describe(e));
  }
}
if (values.positions) {
  console.log(`\nAt ${formatSimTime(sim.t)}:`);
  for (const p of sim.people().filter((p) => p.onMap)) console.log(`  ${p.id.padEnd(14)} ${p.posture.padEnd(8)} ${(p.roomId ?? "-").padEnd(12)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
}
console.log(`\n${count} events, ${ticks} ticks, ends ${formatSimTime(sim.t)}`);

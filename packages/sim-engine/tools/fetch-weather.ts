// Fetches 12 months of hourly weather for London from the Open-Meteo historical weather API
// (ERA5 reanalysis, CC BY 4.0) into data/weather/ (docs/workstreams/v1-testbed, decision 4).
// Node-only and run by hand: the engine reads the checked-in file and never the network.
//
//   pnpm --filter @vch/sim-engine fetch-weather 2025-10-01 2026-09-30

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLACE = { id: "london", name: "London", latitude: 51.5072, longitude: -0.1276 };
/** Open-Meteo variable → CSV column. Hours are GMT: the sim has no daylight saving. */
const VARIABLES: [string, string][] = [
  ["temperature_2m", "tempC"],
  ["relative_humidity_2m", "humidityPct"],
  ["dew_point_2m", "dewPointC"],
  ["precipitation", "precipMm"],
  ["cloud_cover", "cloudPct"],
  ["wind_speed_10m", "windMps"],
  ["wind_direction_10m", "windDirDeg"],
  ["shortwave_radiation", "shortwaveWm2"],
  ["surface_pressure", "pressureHpa"],
  ["is_day", "isDay"],
];

const [start, end] = process.argv.slice(2);
if (!start || !end) throw new Error("Usage: fetch-weather <start YYYY-MM-DD> <end YYYY-MM-DD>");

const url =
  "https://archive-api.open-meteo.com/v1/archive" +
  `?latitude=${PLACE.latitude}&longitude=${PLACE.longitude}&start_date=${start}&end_date=${end}` +
  `&hourly=${VARIABLES.map(([v]) => v).join(",")}&wind_speed_unit=ms&timezone=GMT`;
const response = await fetch(url);
if (!response.ok) throw new Error(`Open-Meteo: ${response.status} ${await response.text()}`);
const body = (await response.json()) as { latitude: number; longitude: number; elevation: number; hourly: Record<string, (number | string | null)[]> };

const times = body.hourly.time as string[];
const rows = times.map((time, i) =>
  [time, ...VARIABLES.map(([v]) => {
    const value = body.hourly[v]![i];
    if (value === null || value === undefined) throw new Error(`Open-Meteo: no ${v} at ${time}`);
    return value;
  })].join(","),
);

const dir = fileURLToPath(new URL("../../../data/weather/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}${PLACE.id}.csv`, [["time", ...VARIABLES.map(([, c]) => c)].join(","), ...rows].join("\n") + "\n");
writeFileSync(
  `${dir}${PLACE.id}.json`,
  JSON.stringify(
    {
      place: PLACE.name,
      latitude: PLACE.latitude,
      longitude: PLACE.longitude,
      grid: { latitude: body.latitude, longitude: body.longitude, elevation_m: body.elevation },
      from: start,
      to: end,
      hours: "GMT (the sim has no daylight saving)",
      columns: Object.fromEntries(VARIABLES.map(([v, c]) => [c, v])),
      source: "Open-Meteo historical weather API (https://open-meteo.com/en/docs/historical-weather-api), ERA5 and ERA5-Land reanalysis from the Copernicus Climate Change Service",
      licence: "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
      fetched_with: "packages/sim-engine/tools/fetch-weather.ts",
    },
    null,
    2,
  ) + "\n",
);
console.log(`${rows.length} hours, ${times[0]} to ${times.at(-1)}, written to data/weather/${PLACE.id}.csv`);

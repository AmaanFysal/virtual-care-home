// The outdoor weather (v1.0-testbed): 12 months of real hourly data, mapped onto the sim's
// calendar by date. The same month, day and hour in the data; runs longer than a year wrap round,
// and 29 February uses the 28th. Data, not physics: the engine only describes it (ADR-0006).

import { SECONDS_PER_DAY, simDate, type WeatherData, type WeatherHour } from "@vch/shared-types";

/** "MM-DD" → index of that day's 00:00 hour in the data. */
const dayIndexes = new WeakMap<WeatherData, Map<string, number>>();

function monthDay(month: number, day: number): string {
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function indexOf(weather: WeatherData): Map<string, number> {
  let index = dayIndexes.get(weather);
  if (!index) {
    index = new Map();
    weather.hours.forEach((h, i) => {
      const key = h.time.slice(5, 10);
      if (!index!.has(key)) index!.set(key, i);
    });
    dayIndexes.set(weather, index);
  }
  return index;
}

/** The last hour looked up, per data set: the weather changes hourly but is read every tick. */
const lastHour = new WeakMap<WeatherData, { hour: number; at: WeatherHour }>();

/** The weather at sim time `t`: the data's hour with the same month, day and hour. */
export function weatherAt(weather: WeatherData, t: number): WeatherHour {
  const key = Math.floor(t / 3600);
  const cached = lastHour.get(weather);
  if (cached?.hour === key) return cached.at;
  const at = lookUp(weather, t);
  lastHour.set(weather, { hour: key, at });
  return at;
}

function lookUp(weather: WeatherData, t: number): WeatherHour {
  const { month, day } = simDate(t);
  const hour = Math.floor((t % SECONDS_PER_DAY) / 3600);
  const index = indexOf(weather);
  const start = index.get(monthDay(month, day)) ?? index.get(monthDay(month, day - 1))!;
  return weather.hours[start + hour]!;
}

/** Whether it's raining this hour (any precipitation). */
export function raining(w: WeatherHour): boolean {
  return w.precipMm > 0;
}

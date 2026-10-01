// Reads the JSON files in data/. Node-only: used by tests, the CLI and the server (src/ does no I/O).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AdmissionCard, DirectorConfig, Scenario, SpriteChoice, WeatherData, WeatherHour, WorldData } from "@vch/shared-types";

const dataDir = fileURLToPath(new URL("../../../data/", import.meta.url));

function read<T>(file: string): T {
  return JSON.parse(readFileSync(dataDir + file, "utf8")) as T;
}

export function loadWorldData(): WorldData {
  return {
    floorplan: read("floorplan.json"),
    residents: read("personas/residents.json"),
    staff: read("personas/staff.json"),
    visitors: read("personas/visitors.json"),
    relationships: read("personas/relationships.json"),
    rota: read("rota.json"),
    building: read("building.json"),
    activities: read("activities.json"),
    weather: loadWeather("london"),
  };
}

/** data/weather/<place>.json (about the data) and .csv (one row per hour, GMT), v1.0-testbed. */
export function loadWeather(place: string): WeatherData {
  const meta = read<Omit<WeatherData, "hours">>(`weather/${place}.json`);
  const [header, ...rows] = readFileSync(`${dataDir}weather/${place}.csv`, "utf8").trim().split("\n");
  const columns = header!.split(",");
  const hours = rows.map((row) => {
    const cells = row.split(",");
    const hour: Record<string, string | number | boolean> = {};
    columns.forEach((c, i) => (hour[c] = c === "time" ? cells[i]! : c === "isDay" ? cells[i] === "1" : Number(cells[i])));
    return hour as unknown as WeatherHour;
  });
  return { place: meta.place, latitude: meta.latitude, longitude: meta.longitude, from: meta.from, to: meta.to, source: meta.source, licence: meta.licence, hours };
}

/** data/director.json: the director's base rates and pacing (docs/10). */
export function loadDirectorConfig(): DirectorConfig {
  return read("director.json");
}

/** New residents' cards (data/personas/admissions.json); only reviewed ones are used. */
export function loadAdmissions(): AdmissionCard[] {
  return read<{ cards: AdmissionCard[] }>("personas/admissions.json").cards;
}

/** data/sprites.json: which sheet draws each person (for the audit's check that nobody on screen shares one). */
export function loadSprites(): SpriteChoice {
  return read("sprites.json");
}

/** A scenario by id (data/scenarios/<id>.json) or by path. */
export function loadScenario(idOrPath: string): Scenario {
  const file = idOrPath.endsWith(".json") ? idOrPath : `${dataDir}scenarios/${idOrPath}.json`;
  return JSON.parse(readFileSync(file, "utf8")) as Scenario;
}

export function scenarioIds(): string[] {
  return readdirSync(`${dataDir}scenarios`).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
}

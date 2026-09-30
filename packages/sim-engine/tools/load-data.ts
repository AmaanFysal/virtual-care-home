// Reads the JSON files in data/. Node-only: used by tests, the CLI and the server (src/ does no I/O).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AdmissionCard, DirectorConfig, Scenario, SpriteChoice, WorldData } from "@vch/shared-types";

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
  };
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

// Test helper: reads the JSON files in data/. Tests may do I/O; src/ may not.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WorldData } from "@vch/shared-types";

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

// data/sprites.json (tools/characters/import.mjs): everyone who can appear in the sim has a
// character sprite, and every sprite entry points to a real file.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENCY } from "@vch/shared-types";
import { loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const repo = new URL("../../../", import.meta.url);
const sprites = JSON.parse(readFileSync(new URL("data/sprites.json", repo), "utf8")) as {
  people: Record<string, { sheet: string; poses: string[]; scale?: number; sit?: string; overlay?: string }>;
  roles: Record<string, Record<string, string>>;
  overlays: Record<string, { image: string }>;
};
const publicFile = (path: string) => new URL(`apps/web/public/${path}`, repo);

describe("character sprites", () => {
  it("has a sprite for every resident and visitor", () => {
    for (const p of [...data.residents, ...data.visitors]) expect(sprites.people[p.id], p.id).toBeDefined();
  });

  it("has a sprite for everyone on the rota, and a role sprite for every agency worker and responder", () => {
    for (const day of Object.values(data.rota.week)) {
      const ids = [day.early.lead, day.early.ca, day.late.lead, day.late.ca, day.night.carer, day.rn_day.nurse, ...day.office, ...day.reception];
      for (const id of ids) if (id !== AGENCY) expect(sprites.people[id], id).toBeDefined();
    }
    for (const s of data.staff) expect(sprites.people[s.id], s.id).toBeDefined();
    expect(sprites.people[data.rota.night_float.id]).toBeDefined();
    expect(sprites.people.ext_oncall_rn).toBeDefined();
    // Agency staff and paramedics are chosen by role and gender at runtime.
    for (const w of data.rota.agency_pool.carer) expect(sprites.people[sprites.roles.agency_carer![w.gender]!], w.name).toBeDefined();
    for (const w of data.rota.agency_pool.nurse) expect(sprites.people[sprites.roles.agency_nurse![w.gender]!], w.name).toBeDefined();
    for (const g of ["female", "male"]) expect(sprites.people[sprites.roles.paramedic![g]!], `paramedic ${g}`).toBeDefined();
  });

  it("points every sprite entry and overlay to a real file, with its credits beside it", () => {
    for (const [id, entry] of Object.entries(sprites.people)) {
      expect(existsSync(publicFile(entry.sheet)), entry.sheet).toBe(true);
      expect(existsSync(publicFile(entry.sheet.replace(/\.png$/, ".credits.txt"))), `${id} credits`).toBe(true);
    }
    for (const o of Object.values(sprites.overlays)) expect(existsSync(publicFile(o.image)), o.image).toBe(true);
    expect(existsSync(new URL("CREDITS.md", repo))).toBe(true);
  });

  it("uses each person's workarounds: Raj sits in his wheelchair, Dennis is only in bed, Peggy has her zimmer, the children are smaller", () => {
    expect(sprites.people.res_raj).toMatchObject({ sit: "wheelchair", poses: ["sit", "bed", "floor"] });
    expect(sprites.people.res_dennis!.poses).toEqual(["bed", "floor"]);
    expect(sprites.people.res_peggy!.overlay).toBe("zimmer");
    expect(sprites.people.vis_arjun!.scale).toBe(0.8);
    expect(sprites.people.vis_priya!.scale).toBe(0.8);
  });
});

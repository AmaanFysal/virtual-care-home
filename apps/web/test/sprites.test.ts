import { describe, expect, it } from "vitest";
import { spriteClashes } from "@vch/shared-types";
import { spriteFor, spriteIdFor, sprites } from "../src/sprites";

describe("sprite choice", () => {
  it("uses a person's own sheet when they have one", () => {
    expect(spriteIdFor({ id: "res_peggy", gender: "female" })).toBe("res_peggy");
    expect(spriteIdFor({ id: "ext_night_float", gender: "female", role: "care_assistant" })).toBe("ext_night_float");
    expect(spriteIdFor({ id: "ext_oncall_rn", gender: "female", role: "registered_nurse" })).toBe("ext_oncall_rn");
  });

  it("chooses agency staff and paramedics by role and gender", () => {
    expect(spriteIdFor({ id: "agy_001", gender: "female", role: "agency_carer" })).toBe("ext_agency_carer");
    expect(spriteIdFor({ id: "agy_002", gender: "male", role: "agency_carer" })).toBe("ext_agency_carer_m");
    expect(spriteIdFor({ id: "agy_003", gender: "male", role: "agency_nurse" })).toBe("ext_agency_nurse");
    expect(spriteIdFor({ id: "ext_paramedics", gender: "female", role: "paramedic" })).toBe("ext_paramedic_f");
  });

  it("carries each person's workarounds", () => {
    expect(spriteFor({ id: "res_raj", gender: "male" })!.sit).toBe("wheelchair");
    expect(spriteFor({ id: "vis_priya", gender: "female" })!.scale).toBe(0.8);
    expect(spriteIdFor({ id: "nobody", gender: "male" })).toBeNull();
  });

  it("gives a resident who moved in mid-run a stand-in by gender", () => {
    expect(spriteIdFor({ id: "res_kamala", gender: "female", kind: "resident" })).toBe("vis_pat");
    expect(spriteIdFor({ id: "res_new", gender: "male", kind: "resident" })).toBe("vis_bernard");
  });
});

describe("nobody on screen looks like someone else", () => {
  it("finds a stand-in sharing a sheet with the person it borrows from", () => {
    const kamala = { id: "res_kamala", gender: "female" as const, kind: "resident" as const };
    const pat = { id: "vis_pat", gender: "female" as const, kind: "visitor" as const };
    expect(spriteClashes(sprites, [kamala, { id: "res_peggy", gender: "female" }])).toEqual([]);
    expect(spriteClashes(sprites, [kamala, pat, { id: "res_peggy", gender: "female" }])).toEqual([{ sheet: "vis_pat", ids: ["res_kamala", "vis_pat"] }]);
  });

  it("finds a main-building carer on screen with the floating carer", () => {
    const main = { id: "mbc_1", gender: "female" as const, role: "main_building_carer" };
    expect(spriteClashes(sprites, [main, { id: "ext_night_float", gender: "female", role: "care_assistant" }])).toEqual([{ sheet: "ext_night_float", ids: ["ext_night_float", "mbc_1"] }]);
  });

  it("lets people in a uniform share it", () => {
    const agency = [
      { id: "agy_001", gender: "female" as const, role: "agency_carer" },
      { id: "agy_002", gender: "female" as const, role: "agency_carer" },
    ];
    expect(spriteClashes(sprites, agency)).toEqual([]);
  });

  it("has every named person on their own sheet", () => {
    const own = Object.keys(sprites.people).filter((id) => /^(res|stf|vis)_/.test(id));
    const sheets = own.map((id) => sprites.people[id]!.sheet);
    expect(new Set(sheets).size).toBe(sheets.length);
  });
});

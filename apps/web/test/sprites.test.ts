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

  it("gives a resident who moved in mid-run their own sheet, or a stand-in by gender until they have one", () => {
    expect(spriteIdFor({ id: "res_kamala", gender: "female", kind: "resident" })).toBe("res_kamala");
    expect(spriteIdFor({ id: "res_new", gender: "female", kind: "resident" })).toBe("vis_pat");
    expect(spriteIdFor({ id: "res_new", gender: "male", kind: "resident" })).toBe("vis_bernard");
  });

  it("draws the main-building carer as Nikos, not in the floating carer's sheet", () => {
    expect(spriteIdFor({ id: "ext_main_carer", gender: "male", role: "main_building_carer" })).toBe("ext_main_carer");
    expect(spriteIdFor({ id: "ext_other_cover", gender: "female", role: "main_building_carer" })).toBe("ext_main_carer");
  });

  it("draws a walking aid for everyone whose card has one: Peggy's zimmer, Win's and Kamala's sticks", () => {
    expect(spriteFor({ id: "res_peggy", gender: "female" })!.overlay).toBe("zimmer");
    expect(spriteFor({ id: "res_win", gender: "female" })!.overlay).toBe("stick");
    expect(spriteFor({ id: "res_kamala", gender: "female" })!.overlay).toBe("stick");
    for (const id of ["res_arthur", "res_stan", "vis_hema"]) expect(spriteFor({ id, gender: "female" })!.overlay).toBeUndefined();
    const stick = sprites.overlays.stick!;
    expect(stick.poses).toEqual(["walk", "stand"]);
    expect(Object.keys(stick.frames).sort()).toEqual(["east", "north", "south", "west"]);
  });
});

describe("nobody on screen looks like someone else", () => {
  it("finds a stand-in sharing a sheet with the person it borrows from", () => {
    const newcomer = { id: "res_new", gender: "female" as const, kind: "resident" as const };
    const pat = { id: "vis_pat", gender: "female" as const, kind: "visitor" as const };
    expect(spriteClashes(sprites, [newcomer, { id: "res_peggy", gender: "female" }])).toEqual([]);
    expect(spriteClashes(sprites, [newcomer, pat, { id: "res_peggy", gender: "female" }])).toEqual([{ sheet: "vis_pat", ids: ["res_new", "vis_pat"] }]);
  });

  it("no longer finds Kamala with Pat, or the main-building carer with the floating carer", () => {
    const kamala = { id: "res_kamala", gender: "female" as const, kind: "resident" as const };
    const pat = { id: "vis_pat", gender: "female" as const, kind: "visitor" as const };
    const nikos = { id: "ext_main_carer", gender: "male" as const, role: "main_building_carer" };
    const lorna = { id: "ext_night_float", gender: "female" as const, role: "care_assistant" };
    expect(spriteClashes(sprites, [kamala, pat, nikos, lorna])).toEqual([]);
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

import { describe, expect, it } from "vitest";
import { spriteFor, spriteIdFor } from "../src/sprites";

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
});

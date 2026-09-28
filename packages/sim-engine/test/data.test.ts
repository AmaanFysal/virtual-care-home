import { describe, expect, it } from "vitest";
import { validateData } from "../src/data/validate.js";
import { loadWorldData } from "../tools/load-data.js";

describe("data/ files", () => {
  const data = loadWorldData();

  it("pass validation", () => {
    expect(validateData(data)).toEqual([]);
  });

  it("have the agreed cast", () => {
    expect(data.residents).toHaveLength(6);
    expect(data.staff).toHaveLength(10);
    expect(data.visitors).toHaveLength(25);
  });

  it("store floor area and ceiling height for every room", () => {
    for (const room of data.floorplan.rooms) {
      expect(room.floor_area_m2).toBeGreaterThan(0);
      expect(room.ceiling_height_m).toBeGreaterThan(0);
    }
  });
});

describe("validateData catches", () => {
  const fresh = () => structuredClone(loadWorldData());

  it("a late shift followed by an early", () => {
    const data = fresh();
    data.rota.week.Wed.early.ca = "stf_aisha"; // Aisha works the Tuesday late
    expect(validateData(data).join("\n")).toMatch(/stf_aisha works a late then an early/);
  });

  it("a late lead who isn't meds-trained", () => {
    const data = fresh();
    data.rota.week.Tue.late.lead = "stf_tom";
    expect(validateData(data).join("\n")).toMatch(/late lead must be meds-trained/);
  });

  it("a point outside its room", () => {
    const data = fresh();
    data.floorplan.points[0]!.x = 50;
    expect(validateData(data).join("\n")).toMatch(/is not inside/);
  });

  it("a wrong floor area", () => {
    const data = fresh();
    data.floorplan.rooms[0]!.floor_area_m2 = 10;
    expect(validateData(data).join("\n")).toMatch(/floor_area_m2/);
  });

  it("a dangling next of kin", () => {
    const data = fresh();
    data.residents[0]!.care.next_of_kin = "vis_sarah"; // Sarah is Dennis's daughter, not Peggy's
    expect(validateData(data).join("\n")).toMatch(/next_of_kin "vis_sarah"/);
  });

  it("a man in the female room", () => {
    const data = fresh();
    data.residents.find((r) => r.id === "res_stan")!.room = "Room1.BedB";
    data.residents.find((r) => r.id === "res_win")!.room = "Room2.BedC";
    expect(validateData(data).join("\n")).toMatch(/Room1 is a female room/);
  });
});

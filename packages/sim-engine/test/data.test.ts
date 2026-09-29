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
    expect(data.staff.filter((s) => s.employment === "permanent")).toHaveLength(10);
    expect(data.staff.filter((s) => s.employment === "bank").map((s) => s.id)).toEqual(["stf_lucy", "stf_shanice"]);
    expect(data.visitors).toHaveLength(25);
  });

  it("use agency only for RN days and one lone night a week", () => {
    const week = Object.values(data.rota.week);
    const agencyNights = week.filter((day) => day.night.carer === "AGENCY");
    expect(agencyNights.length).toBeLessThanOrEqual(1);
    const agencyDayCarers = week.flatMap((day) => [day.early.lead, day.early.ca, day.late.lead, day.late.ca]).filter((id) => id === "AGENCY");
    expect(agencyDayCarers).toEqual([]); // bank staff cover these; agency only for injected sickness later
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

  it("bedside seating that doesn't match how each resident sits out", () => {
    // Only residents who sit out in their room have a bedside chair: not Raj (wheelchair) or Dennis (bed-bound).
    const expectChairs = (d: ReturnType<typeof fresh>) => d.floorplan.furniture.filter((f) => f.kind === "chair" && /^Room\d\.Bed[A-D]\.chair$/.test(f.id)).map((f) => f.id).sort();
    expect(expectChairs(fresh())).toEqual(["Room1.BedA.chair", "Room1.BedB.chair", "Room2.BedA.chair", "Room2.BedC.chair"]);

    const noPeggyChair = fresh();
    noPeggyChair.floorplan.furniture = noPeggyChair.floorplan.furniture.filter((f) => f.id !== "Room1.BedA.chair");
    expect(validateData(noPeggyChair)).toContain("resident res_peggy: needs bedside chair furniture Room1.BedA.chair");

    const rajChair = fresh();
    rajChair.floorplan.points.push({ id: "Room2.BedB.Chair", kind: "chair", room: "Room2", x: 12.25, y: 3.25 });
    expect(validateData(rajChair)).toContain("resident res_raj: uses a wheelchair, so no bedside chair");

    const crowded = fresh();
    crowded.floorplan.furniture.push({ id: "Room2.clutter", kind: "chair", room: "Room2", rect: { x: 12.5, y: 3.0, w: 0.5, h: 0.5 }, blocks: false });
    expect(validateData(crowded)).toContain("resident res_raj: Room2.clutter is within 1 m of the wheelchair spot (hoist and wheelchair space)");

    const dennisChair = fresh();
    dennisChair.floorplan.points.push({ id: "Room2.BedD.Chair", kind: "chair", room: "Room2", x: 17.25, y: 2.75 });
    expect(validateData(dennisChair)).toContain("resident res_dennis: bed-bound, so no bedside chair or wheelchair spot");
  });

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

  it("a day shift with no female carer", () => {
    const data = fresh();
    data.rota.week.Tue.late.ca = "stf_tom"; // Dave and Tom
    expect(validateData(data).join("\n")).toMatch(/Tue: the late shift has no female carer/);
  });

  it("a man in the female room", () => {
    const data = fresh();
    data.residents.find((r) => r.id === "res_stan")!.room = "Room1.BedB";
    data.residents.find((r) => r.id === "res_win")!.room = "Room2.BedC";
    expect(validateData(data).join("\n")).toMatch(/Room1 is a female room/);
  });
});

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
    const expectChairs = (d: ReturnType<typeof fresh>) => d.floorplan.furniture.filter((f) => f.kind === "chair" && /^Room\d\.Bed\.chair$/.test(f.id)).map((f) => f.id).sort();
    expect(expectChairs(fresh())).toEqual(["Room1.Bed.chair", "Room2.Bed.chair", "Room4.Bed.chair", "Room5.Bed.chair"]);

    const noPeggyChair = fresh();
    noPeggyChair.floorplan.furniture = noPeggyChair.floorplan.furniture.filter((f) => f.id !== "Room5.Bed.chair");
    expect(validateData(noPeggyChair)).toContain("resident res_peggy: needs bedside chair furniture Room5.Bed.chair");

    const rajChair = fresh();
    rajChair.floorplan.points.push({ id: "Room3.Bed.Chair", kind: "chair", room: "Room3", x: 10.75, y: 3.25 });
    expect(validateData(rajChair)).toContain("resident res_raj: uses a wheelchair, so no bedside chair");

    const crowded = fresh();
    crowded.floorplan.furniture.push({ id: "Room3.clutter", kind: "chair", room: "Room3", rect: { x: 11.5, y: 3.0, w: 0.5, h: 0.5 }, blocks: false });
    expect(validateData(crowded)).toContain("resident res_raj: Room3.clutter is within 1 m of the wheelchair spot (hoist and wheelchair space)");

    const dennisChair = fresh();
    dennisChair.floorplan.points.push({ id: "Room6.Bed.Chair", kind: "chair", room: "Room6", x: 22.75, y: 2.75 });
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

  it("a shared room, or a bedroom without its own en-suite", () => {
    const shared = fresh();
    shared.floorplan.points.push({ id: "Room5.Bed2", kind: "bed", room: "Room5", x: 19.25, y: 1.0 });
    expect(validateData(shared)).toContain("resident res_peggy: Room5 should be a single room, but has 2 beds");

    const noEnsuite = fresh();
    noEnsuite.floorplan.rooms = noEnsuite.floorplan.rooms.filter((r) => r.id !== "Ensuite3");
    expect(validateData(noEnsuite)).toContain("floorplan: bedroom Room3 needs exactly one en-suite, found 0");
  });

  it("a bed without room for a carer either side, or an en-suite door too narrow", () => {
    const tight = fresh();
    tight.floorplan.furniture.find((f) => f.id === "Room2.Bed.bed")!.rect.x = 4.5; // 0.5 m from the wall
    expect(validateData(tight)).toContain("floorplan: Room2.Bed.bed has 0.5 m and 2.5 m clear either side; two carers need at least 1.2 m on both sides");
    const narrow = fresh();
    narrow.floorplan.doors.find((d) => d.id === "D_Ensuite2")!.clear_width_m = 0.7;
    expect(validateData(narrow).join("\n")).toMatch(/door D_Ensuite2 clear width 0.7 m must be at least 0.8 m/);
    expect(fresh().floorplan.doors.filter((d) => d.id.startsWith("D_Ensuite")).map((d) => d.clear_width_m)).toEqual([0.9, 0.9, 0.9, 0.9, 0.9, 0.9]);
  });

  it("doorways that touch, which could lock two people in place", () => {
    // Room 1's corridor door moved next to its en-suite door: their doorway cells become neighbours.
    const data = fresh();
    const door = data.floorplan.doors.find((d) => d.id === "D_Room1")!;
    Object.assign(door, { x1: 1.5, x2: 2.5 });
    expect(validateData(data).join("\n")).toMatch(/doors D_Room1 and D_Ensuite1 are too close|doors D_Ensuite1 and D_Room1 are too close/);
  });

  it("a window on an inner wall, off its room's edge, or over a door (v1.0-testbed)", () => {
    const d = fresh();
    const w = d.floorplan.windows.find((x) => x.id === "Window_Room1")!;
    Object.assign(w, { wall: "W_Bedrooms_Corridor", y1: 5.5, y2: 5.5 });
    expect(validateData(d).join("\n")).toMatch(/Window_Room1 isn't on an outer wall/);
    const e = fresh();
    Object.assign(e.floorplan.windows.find((x) => x.id === "Window_Reception")!, { x1: 10.5, x2: 11.7 });
    expect(validateData(e).join("\n")).toMatch(/Window_Reception overlaps door D_Exit/);
  });

  it("a door with no rule, or a bedroom door given one (v1.0-testbed)", () => {
    const d = fresh();
    d.building.doors.closed = [];
    d.building.doors.held_open_by_day.push("D_Room1");
    const errors = validateData(d).join("\n");
    expect(errors).toMatch(/door D_StaffRoom needs exactly one rule/);
    expect(errors).toMatch(/D_Room1 is a bedroom or en-suite door/);
  });

  it("a night-time door left open or ajar without a reason (v1.0-testbed)", () => {
    const d = fresh();
    d.residents.find((r) => r.id === "res_win")!.care.door_at_night = "open";
    expect(validateData(d).join("\n")).toMatch(/res_win: door_at_night "open" needs a door_at_night_reason/);
  });

  it("an activity without a MET, or whose last entry has conditions (v1.0-testbed)", () => {
    const d = fresh();
    delete d.activities.other.personal_care;
    d.activities.resident.walking = d.activities.resident.walking!.slice(0, 1);
    const errors = validateData(d).join("\n");
    expect(errors).toMatch(/no other entry for "personal_care"/);
    expect(errors).toMatch(/resident "walking" needs a last entry with no conditions/);
  });

  it("weather with a missing hour, a value out of range, or less than a year (v1.0-testbed)", () => {
    const d = fresh();
    d.weather!.hours.splice(100, 1);
    expect(validateData(d).join("\n")).toMatch(/weather: hour 100 is .*, expected/);
    const e = fresh();
    e.weather!.hours[5]!.humidityPct = 140;
    expect(validateData(e).join("\n")).toMatch(/humidityPct 140 is out of range/);
    const f = fresh();
    f.weather!.hours = f.weather!.hours.slice(0, 24 * 300);
    expect(validateData(f).join("\n")).toMatch(/the data must cover a whole year/);
  });
});

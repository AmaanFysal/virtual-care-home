// The pixel-art map's pure helpers: the banded metres <-> pixels mapping, seat facings, activity
// icons, and click picking through the same mapping the renderer draws with.

import { describe, expect, it } from "vitest";
import type { FloorPlan, PersonView } from "@vch/shared-types";
import floorplan from "../../../data/floorplan.json";
import { BLEND_M, FACE_PX, PAD_PX, TILE_PX, makeBanding } from "../src/canvas/banding";
import { activityIcon, directionOf, facingFixture, figureBox, makeSlide, pickPerson, seatFacings, slideAt, slideRest } from "../src/canvas/figures";

const plan = floorplan as unknown as FloorPlan;
const banding = makeBanding(plan);

describe("banded mapping", () => {
  it("puts a 64 px face band at the three south-facing walls and none at the south outer wall", () => {
    expect(banding.bands.map((b) => [b.y, b.blended])).toEqual([
      [0, false],
      [5.5, true],
      [7.5, true],
    ]);
    expect(banding.size).toEqual({ w: 26.5 * TILE_PX + 2 * PAD_PX, h: 13 * TILE_PX + 3 * FACE_PX + 2 * PAD_PX });
  });

  it("is 32 px a metre away from the walls, shifted by the bands above", () => {
    expect(banding.y(2)).toBe(PAD_PX + FACE_PX + 2 * TILE_PX); // a bedroom
    expect(banding.y(6.5)).toBe(PAD_PX + 2 * FACE_PX + 6.5 * TILE_PX); // the corridor
    expect(banding.y(10)).toBe(PAD_PX + 3 * FACE_PX + 10 * TILE_PX); // the south rooms
    expect(banding.x(3)).toBe(PAD_PX + 3 * TILE_PX);
  });

  it("stretches the doorway crossing over the band, continuously and in order", () => {
    const L = 5.5;
    expect(banding.y(L + BLEND_M) - banding.y(L - BLEND_M)).toBe(2 * BLEND_M * TILE_PX + FACE_PX);
    let prev = -Infinity;
    for (let m = 0; m <= 13; m += 0.01) {
      const y = banding.y(m);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });

  it("round-trips world -> screen -> world everywhere on the map", () => {
    for (let m = 0; m <= 13; m += 0.05) {
      const back = banding.toWorld(banding.toScreen({ x: 3.3, y: m }));
      expect(back.x).toBeCloseTo(3.3, 9);
      expect(back.y).toBeCloseTo(m, 9);
    }
  });
});

describe("seat facings", () => {
  const facings = seatFacings(plan);
  it("turns chairs to their table or desk, armchairs to the TV, and bedside and reading chairs south, towards the camera", () => {
    for (const id of ["Room1.BedA.chair", "Room1.BedB.chair", "Room2.BedA.chair", "Room2.BedB.chair", "Room2.BedC.chair", "Room2.BedD.chair"]) expect(facings.get(id), id).toBe("south");
    expect(facings.get("WaitingArea.chair1")).toBe("east");
    expect(facings.get("WaitingArea.chair3")).toBe("west");
    expect(facings.get("WaitingArea.chair5")).toBe("south");
    expect(facings.get("WaitingArea.chair7")).toBe("north");
    expect(facings.get("Reception.deskChair")).toBe("east");
    expect(facings.get("Lounge.diningChair1")).toBe("south");
    expect(facings.get("Lounge.diningChair4")).toBe("north");
    expect(facings.get("Lounge.activityChair3")).toBe("west");
    for (const i of [1, 2, 3, 4]) expect(facings.get(`Lounge.armchair${i}`)).toBe("east");
    expect(facings.get("Lounge.readingChair")).toBe("south");
  });
});

describe("facing and activity icons", () => {
  it("faces the way someone moves, and keeps their facing when still", () => {
    expect(directionOf(1, 0.2, "south")).toBe("east");
    expect(directionOf(0, -1, "south")).toBe("north");
    expect(directionOf(0, 0, "west")).toBe("west");
  });

  it("derives the icon from badges, posture and task", () => {
    const v = (over: Partial<PersonView>) => ({ kind: "staff" as const, posture: "standing" as const, badges: [], task: null, ...over });
    expect(activityIcon(v({ posture: "on_floor" }))).toBe("fall");
    expect(activityIcon(v({ badges: ["pill"] }))).toBe("meds");
    expect(activityIcon(v({ badges: ["tray"] }))).toBe("meal");
    expect(activityIcon(v({ badges: ["cup"] }))).toBe("drink");
    expect(activityIcon(v({ badges: ["hoist"] }))).toBe("care");
    expect(activityIcon(v({ badges: ["asleep"] }))).toBe("asleep");
    expect(activityIcon(v({ posture: "dozing" }))).toBe("asleep");
    expect(activityIcon(v({ badges: ["break"] }))).toBe("break");
    expect(activityIcon(v({ task: "Writing care notes" }))).toBe("notes");
    expect(activityIcon(v({ kind: "visitor", task: "Visiting Peggy" }))).toBe("visiting");
    expect(activityIcon(v({ task: "Sitting with Stan" }))).toBe("chatting");
    expect(activityIcon(v({}))).toBeNull();
  });
});

describe("click to select", () => {
  const person = (id: string, x: number, y: number, posture: PersonView["posture"] = "standing") => figureBox({ id, posture }, { x, y }, banding);

  it("selects a person when their drawn body is clicked", () => {
    const f = person("stf_maria", 12, 6.75);
    expect(pickPerson([f], { x: f.anchor.x, y: f.anchor.y - 30 })).toBe("stf_maria");
    expect(pickPerson([f], { x: f.anchor.x + 40, y: f.anchor.y - 30 })).toBeNull();
  });

  it("selects someone standing just below a wall face, whose body is drawn over the face", () => {
    // Stepping out of Room 1 into the corridor: the head is drawn over the bedroom-corridor face.
    const f = person("res_win", 3.5, 5.75);
    const band = banding.bands.find((b) => b.y === 5.5)!;
    const head = { x: f.anchor.x, y: f.anchor.y - 44 };
    expect(head.y).toBeGreaterThan(band.top);
    expect(head.y).toBeLessThan(band.top + FACE_PX);
    expect(pickPerson([f], head)).toBe("res_win");
    // The same click read back through the mapping lands in the bedroom, so picking by world
    // position would miss her: picking works on the drawn figures instead.
    expect(banding.toWorld(head).y).toBeLessThan(5.5);
  });

  it("prefers the figure in front when two overlap", () => {
    const behind = person("res_peggy", 3.5, 5.75);
    const front = person("stf_blessing", 3.6, 6);
    const both = { x: front.anchor.x, y: front.anchor.y - 20 };
    expect(pickPerson([front, behind], both)).toBe("stf_blessing");
    expect(pickPerson([behind, front], both)).toBe("stf_blessing");
    expect(pickPerson([behind, front], { x: behind.anchor.x, y: behind.anchor.y - 45 })).toBe("res_peggy");
  });

  it("selects a resident in bed by the head on the pillow", () => {
    const f = person("res_dennis", 18, 1, "in_bed");
    expect(pickPerson([f], f.anchor)).toBe("res_dennis");
    expect(f.anchor.y).toBeLessThan(banding.y(1));
  });
});

describe("sliding through turning points", () => {
  // Out of Room 1 through its door (x 3 to 4 at y 5.5) and along the corridor.
  const slide = makeSlide([{ x: 2.25, y: 4.75 }, { x: 3.25, y: 5.25 }, { x: 3.25, y: 5.75 }, { x: 6.25, y: 6.75 }]);

  it("goes through each turning point in order, by distance", () => {
    expect(slideAt(slide, 0)).toEqual({ x: 2.25, y: 4.75 });
    expect(slideAt(slide, 1)).toEqual({ x: 6.25, y: 6.75 });
    const total = slide.cum[slide.cum.length - 1]!;
    const atDoor = slideAt(slide, slide.cum[1]! / total);
    expect(atDoor.x).toBeCloseTo(3.25, 9);
    expect(atDoor.y).toBeCloseTo(5.25, 9);
    // Crossing the wall line happens inside the door gap, never beside it.
    for (let k = 0; k <= 1; k += 0.01) {
      const p = slideAt(slide, k);
      if (Math.abs(p.y - 5.5) < 0.01) expect(p.x).toBeGreaterThanOrEqual(3);
    }
  });

  it("carries on from mid-slide with the turning points still ahead", () => {
    const total = slide.cum[slide.cum.length - 1]!;
    const rest = slideRest(slide, slide.cum[1]! / total / 2);
    expect(rest.slice(1)).toEqual(slide.points.slice(1));
  });

  it("faces the toilet when standing still beside it", () => {
    expect(facingFixture(plan, 7.25, 4.75)).toBe("west"); // Room 1's standing point, east of the toilet
    expect(facingFixture(plan, 6.75, 4.75)).toBeNull(); // on the seat itself
    expect(facingFixture(plan, 3, 3)).toBeNull();
  });
});

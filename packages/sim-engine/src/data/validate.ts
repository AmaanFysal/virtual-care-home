// Checks the static data in `data/` for broken references, impossible geometry and rota
// rule breaches. Pure: takes parsed data, returns a list of human-readable errors.

import {
  AGENCY,
  OTHER_ACTIVITIES,
  RESIDENT_ACTIVITIES,
  WEEKDAYS,
  clockToSeconds,
  type Competency,
  type Door,
  type FloorPlan,
  type Rect,
  type RotaDay,
  type Staff,
  type WorldData,
} from "@vch/shared-types";
import { buildGrid } from "../world/grid.js";

const EPS = 1e-6;

/** Named points the Lounge routine uses (src/lounge.ts). */
const LOUNGE_POINTS = ["Lounge.Post", "Lounge.Reading", ...[1, 2, 3, 4, 5, 6].map((n) => `Lounge.Dining${n}`), ...[1, 2, 3, 4].map((n) => `Lounge.Armchair${n}`), ...[1, 2, 3, 4].map((n) => `Lounge.Activity${n}`)];

const ROLES = new Set(["wing_manager", "registered_nurse", "senior_carer", "care_assistant", "activities_coordinator", "receptionist"]);
const COMPETENCIES = new Set<Competency>([
  "meds_trained",
  "fall_assessment",
  "moving_handling",
  "moving_handling_trainer",
  "dementia_level2",
  "end_of_life_care",
  "first_aid",
  "care_certificate_in_progress",
]);
const CARER_ROLES = new Set(["senior_carer", "care_assistant"]);

export function validateData(data: WorldData): string[] {
  const errors: string[] = [];
  validateFloorPlan(data.floorplan, errors);
  validatePeople(data, errors);
  validateRota(data, errors);
  validateBuilding(data, errors);
  return errors;
}

// ---------------------------------------------------------------- floor plan

function inside(x: number, y: number, r: Rect): boolean {
  return x > r.x + EPS && x < r.x + r.w - EPS && y > r.y + EPS && y < r.y + r.h - EPS;
}

function rectWithin(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y + inner.h <= outer.y + outer.h + EPS
  );
}

/** True if segment (x1,y1)-(x2,y2) lies on the rect's boundary. */
function onRectEdge(d: Door, r: Rect): boolean {
  const horizontal = Math.abs(d.y1 - d.y2) < EPS;
  if (horizontal) {
    const onEdge = Math.abs(d.y1 - r.y) < EPS || Math.abs(d.y1 - (r.y + r.h)) < EPS;
    return onEdge && Math.min(d.x1, d.x2) >= r.x - EPS && Math.max(d.x1, d.x2) <= r.x + r.w + EPS;
  }
  const onEdge = Math.abs(d.x1 - r.x) < EPS || Math.abs(d.x1 - (r.x + r.w)) < EPS;
  return onEdge && Math.min(d.y1, d.y2) >= r.y - EPS && Math.max(d.y1, d.y2) <= r.y + r.h + EPS;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

function validateFloorPlan(fp: FloorPlan, errors: string[]): void {
  for (const [label, list] of [
    ["room", fp.rooms],
    ["wall", fp.walls],
    ["door", fp.doors],
    ["window", fp.windows],
    ["equipment", fp.equipment],
    ["furniture", fp.furniture],
    ["point", fp.points],
  ] as const) {
    for (const id of duplicates(list.map((item) => item.id))) errors.push(`floorplan: duplicate ${label} id "${id}"`);
  }

  const rooms = new Map(fp.rooms.map((r) => [r.id, r]));
  const walls = new Map(fp.walls.map((w) => [w.id, w]));
  const bounds: Rect = { x: 0, y: 0, w: fp.size.w, h: fp.size.h };

  // A room may sit inside another (an en-suite inside its bedroom); the outer room's area excludes it.
  const nestedIn = (outer: { id: string; rect: Rect }) => fp.rooms.filter((r) => r.id !== outer.id && rectWithin(r.rect, outer.rect));
  for (const room of fp.rooms) {
    if (!rectWithin(room.rect, bounds)) errors.push(`floorplan: room ${room.id} is outside the wing`);
    const inner = nestedIn(room).reduce((a, r) => a + r.rect.w * r.rect.h, 0);
    if (Math.abs(room.floor_area_m2 - (room.rect.w * room.rect.h - inner)) > 0.01) {
      errors.push(`floorplan: room ${room.id} floor_area_m2 ${room.floor_area_m2} does not match its rect`);
    }
    if (!(room.ceiling_height_m > 0)) errors.push(`floorplan: room ${room.id} needs a ceiling height`);
    for (const inner of nestedIn(room)) {
      if (inner.kind !== "ensuite" || room.kind !== "bedroom") errors.push(`floorplan: only an en-suite may sit inside a room, and only inside a bedroom (${inner.id} in ${room.id})`);
    }
  }
  // Doorways never touch: the cells either side of each door are single-occupancy, so if two
  // doors' cells were neighbours, two people could each hold one and wait for the other for ever.
  const grid = buildGrid(fp);
  for (const [a, cellsA] of grid.doorZones) {
    for (const [b, cellsB] of grid.doorZones) {
      if (a >= b) continue;
      const touching = cellsA.some((ca) => cellsB.some((cb) => Math.abs((ca % grid.cols) - (cb % grid.cols)) <= 1 && Math.abs(Math.floor(ca / grid.cols) - Math.floor(cb / grid.cols)) <= 1));
      if (touching) errors.push(`floorplan: doors ${a} and ${b} are too close: their doorways touch, which can lock two people in place`);
    }
  }
  // Two carers work either side of a bed (turns, hoisting): clear floor both sides, along its length.
  for (const bed of fp.furniture.filter((f) => f.kind === "bed")) {
    const room = rooms.get(bed.room);
    if (!room) continue;
    const alongside = fp.furniture.filter((f) => f !== bed && f.room === bed.room && f.rect.y < bed.rect.y + bed.rect.h && f.rect.y + f.rect.h > bed.rect.y);
    const west = Math.min(bed.rect.x - room.rect.x, ...alongside.filter((f) => f.rect.x + f.rect.w <= bed.rect.x).map((f) => bed.rect.x - (f.rect.x + f.rect.w)));
    const east = Math.min(room.rect.x + room.rect.w - (bed.rect.x + bed.rect.w), ...alongside.filter((f) => f.rect.x >= bed.rect.x + bed.rect.w).map((f) => f.rect.x - (bed.rect.x + bed.rect.w)));
    if (Math.min(west, east) < BED_SIDE_CLEARANCE_M) errors.push(`floorplan: ${bed.id} has ${west} m and ${east} m clear either side; two carers need at least ${BED_SIDE_CLEARANCE_M} m on both sides`);
  }
  // Single rooms: every bedroom has exactly one en-suite inside it, with a WC point.
  for (const room of fp.rooms.filter((r) => r.kind === "bedroom")) {
    const ensuites = nestedIn(room).filter((r) => r.kind === "ensuite");
    if (ensuites.length !== 1) errors.push(`floorplan: bedroom ${room.id} needs exactly one en-suite, found ${ensuites.length}`);
    for (const e of ensuites) if (!fp.points.some((p) => p.kind === "wc" && p.room === e.id)) errors.push(`floorplan: en-suite ${e.id} has no WC point`);
  }

  for (const door of fp.doors) {
    const wall = walls.get(door.wall);
    if (!wall) {
      errors.push(`floorplan: door ${door.id} is on unknown wall "${door.wall}"`);
    } else {
      const wallRect: Rect = {
        x: Math.min(wall.x1, wall.x2),
        y: Math.min(wall.y1, wall.y2),
        w: Math.abs(wall.x2 - wall.x1),
        h: Math.abs(wall.y2 - wall.y1),
      };
      if (!rectWithin({ x: Math.min(door.x1, door.x2), y: Math.min(door.y1, door.y2), w: Math.abs(door.x2 - door.x1), h: Math.abs(door.y2 - door.y1) }, wallRect)) {
        errors.push(`floorplan: door ${door.id} does not lie on wall ${door.wall}`);
      }
    }
    if (door.clear_width_m !== undefined) {
      const gap = Math.hypot(door.x2 - door.x1, door.y2 - door.y1);
      // 0.8 m is about the least a wheelchair or hoist can pass through.
      if (door.clear_width_m < 0.8 || door.clear_width_m > gap) errors.push(`floorplan: door ${door.id} clear width ${door.clear_width_m} m must be at least 0.8 m and fit its ${gap} m opening`);
    }
    for (const roomId of door.rooms) {
      if (roomId === "Outside") continue;
      const room = rooms.get(roomId);
      if (!room) errors.push(`floorplan: door ${door.id} connects unknown room "${roomId}"`);
      // A door into an en-suite is on the en-suite's edge, inside the bedroom.
      else if (!onRectEdge(door, room.rect) && !nestedIn(room).some((inner) => onRectEdge(door, inner.rect))) errors.push(`floorplan: door ${door.id} is not on the edge of ${roomId}`);
    }
  }

  // Every room reachable from Reception through doors.
  const reached = new Set<string>(["Reception"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const door of fp.doors) {
      const [a, b] = door.rooms;
      if (reached.has(a) && !reached.has(b)) (reached.add(b), (grew = true));
      if (reached.has(b) && !reached.has(a)) (reached.add(a), (grew = true));
    }
  }
  for (const room of fp.rooms) if (!reached.has(room.id)) errors.push(`floorplan: room ${room.id} has no door path to Reception`);
  if (!fp.doors.some((d) => d.rooms.includes("Outside"))) errors.push("floorplan: no door to Outside");

  for (const f of fp.furniture) {
    const room = rooms.get(f.room);
    if (!room) errors.push(`floorplan: furniture ${f.id} is in unknown room "${f.room}"`);
    else if (!rectWithin(f.rect, room.rect)) errors.push(`floorplan: furniture ${f.id} sticks out of ${f.room}`);
  }

  const blockers = fp.furniture.filter((f) => f.blocks);
  for (const p of fp.points) {
    const room = rooms.get(p.room);
    if (!room) {
      errors.push(`floorplan: point ${p.id} is in unknown room "${p.room}"`);
      continue;
    }
    if (!inside(p.x, p.y, room.rect)) errors.push(`floorplan: point ${p.id} is not inside ${p.room}`);
    if (p.kind !== "bed" && blockers.some((f) => inside(p.x, p.y, f.rect))) {
      errors.push(`floorplan: point ${p.id} is inside blocking furniture`);
    }
  }
  if (!fp.points.some((p) => p.id === "ExitDoor")) errors.push("floorplan: missing ExitDoor point");
  // Staff never use a WC seat: each WC has a standing work point beside it (docs/02).
  for (const wc of fp.points.filter((p) => p.kind === "wc")) {
    const stand = fp.points.find((p) => p.id === `${wc.id}.Stand`);
    if (!stand || stand.room !== wc.room || stand.kind !== "waypoint") errors.push(`floorplan: WC point ${wc.id} has no standing point ${wc.id}.Stand (a waypoint in ${wc.room})`);
  }

  // The residents' Lounge: one room, off the corridor, with seats for everyone who uses it (docs/02).
  const lounges = fp.rooms.filter((r) => r.kind === "lounge");
  if (lounges.length !== 1) errors.push(`floorplan: expected exactly one lounge room, found ${lounges.length}`);
  const lounge = lounges[0];
  if (lounge) {
    if (!fp.doors.some((d) => d.rooms.includes(lounge.id) && d.rooms.includes("Corridor"))) errors.push(`floorplan: lounge ${lounge.id} needs a door to the Corridor`);
    for (const id of LOUNGE_POINTS) if (!fp.points.some((p) => p.id === id && p.room === lounge.id)) errors.push(`floorplan: lounge is missing point ${id}`);
  }
}

// ---------------------------------------------------------------- people

function checkClock(value: string | null, where: string, errors: string[]): void {
  if (value === null) return;
  try {
    clockToSeconds(value);
  } catch {
    errors.push(`${where}: bad time "${value}"`);
  }
}

/** Clear floor needed either side of a bed for two carers (turns, hoisting), in metres. */
const BED_SIDE_CLEARANCE_M = 1.2;

/** Clear floor needed around a wheelchair spot for the hoist and the wheelchair (metres). */
const WHEELCHAIR_CLEARANCE_M = 1;

/**
 * Bedside seating (docs/02): a resident who sits out in their room has their own bedside chair; a
 * hoisted wheelchair user (Raj) has a wheelchair spot by the bed instead, with clear floor around
 * it and no chair; a bed-bound resident (Dennis) has neither. There are no visitor chairs.
 */
function checkBedsideSeat(r: WorldData["residents"][number], floorplan: WorldData["floorplan"], where: string, errors: string[]): void {
  const point = (suffix: string) => floorplan.points.find((p) => p.id === `${r.room}${suffix}`);
  const chair = point(".Chair");
  const wheelchair = point(".Wheelchair");
  const chairFurniture = floorplan.furniture.find((f) => f.id === `${r.room}.chair`);
  const bedRoom = floorplan.points.find((p) => p.id === r.room)?.room;
  if (r.care.bed_bound) {
    if (chair || wheelchair || chairFurniture) errors.push(`${where}: bed-bound, so no bedside chair or wheelchair spot`);
  } else if (r.care.transfer_method === "hoist") {
    if (chair || chairFurniture) errors.push(`${where}: uses a wheelchair, so no bedside chair`);
    if (!wheelchair || wheelchair.kind !== "wheelchair" || wheelchair.room !== bedRoom) errors.push(`${where}: needs a wheelchair spot ${r.room}.Wheelchair (kind wheelchair) in ${bedRoom}`);
    else {
      const blocking = floorplan.furniture.filter((f) => f.id !== `${r.room}.bed` && f.room === bedRoom).filter((f) => {
        const dx = Math.max(f.rect.x - wheelchair.x, 0, wheelchair.x - (f.rect.x + f.rect.w));
        const dy = Math.max(f.rect.y - wheelchair.y, 0, wheelchair.y - (f.rect.y + f.rect.h));
        return Math.hypot(dx, dy) < WHEELCHAIR_CLEARANCE_M;
      });
      for (const f of blocking) errors.push(`${where}: ${f.id} is within ${WHEELCHAIR_CLEARANCE_M} m of the wheelchair spot (hoist and wheelchair space)`);
    }
  } else {
    if (!chair || chair.kind !== "chair" || chair.room !== bedRoom) errors.push(`${where}: needs a bedside chair point ${r.room}.Chair`);
    if (!chairFurniture || chairFurniture.kind !== "chair") errors.push(`${where}: needs bedside chair furniture ${r.room}.chair`);
    if (wheelchair) errors.push(`${where}: walks, so no wheelchair spot`);
  }
}

function validatePeople(data: WorldData, errors: string[]): void {
  const { residents, staff, visitors, relationships, floorplan } = data;
  const allIds = [...residents, ...staff, ...visitors].map((p) => p.id);
  for (const id of duplicates(allIds)) errors.push(`personas: duplicate id "${id}"`);
  const known = new Set(allIds);
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const visitorById = new Map(visitors.map((v) => [v.id, v]));
  const points = new Map(floorplan.points.map((p) => [p.id, p]));

  const idPrefix = (id: string, prefix: string, where: string) => {
    if (!id.startsWith(prefix)) errors.push(`${where}: id "${id}" should start with "${prefix}"`);
  };

  // Residents
  const beds = new Set<string>();
  for (const r of residents) {
    const where = `resident ${r.id}`;
    idPrefix(r.id, "res_", where);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dob)) errors.push(`${where}: bad dob "${r.dob}"`);
    const bed = points.get(r.room);
    if (!bed || bed.kind !== "bed") errors.push(`${where}: room "${r.room}" is not a bed point`);
    else {
      if (beds.has(r.room)) errors.push(`${where}: bed ${r.room} is already taken`);
      beds.add(r.room);
      // Single rooms: one bed per bedroom, and the resident's WC is their own en-suite's (RoomN.WC).
      const sharing = floorplan.points.filter((p) => p.kind === "bed" && p.room === bed.room);
      if (sharing.length !== 1) errors.push(`${where}: ${bed.room} should be a single room, but has ${sharing.length} beds`);
      const wc = points.get(`${r.room.split(".")[0]}.WC`);
      const ownEnsuite = floorplan.rooms.find((room) => room.kind === "ensuite" && wc?.room === room.id && rectWithin(room.rect, floorplan.rooms.find((b) => b.id === bed.room)!.rect));
      if (!wc || !ownEnsuite) errors.push(`${where}: needs a WC point ${r.room.split(".")[0]}.WC in the en-suite of ${bed.room}`);
    }
    checkBedsideSeat(r, floorplan, where, errors);
    for (const t of r.medication_rounds) checkClock(t, where, errors);
    checkClock(r.routine.wake, where, errors);
    checkClock(r.routine.bed, where, errors);
    checkClock(r.routine.nap, where, errors);
    if (r.cognition.sundowning) checkClock(r.cognition.sundowning.onset, where, errors);
    for (const rel of r.staff_relationships) {
      if (!staffById.has(rel.staff)) errors.push(`${where}: unknown staff "${rel.staff}"`);
    }

    const care = r.care;
    if (!care) {
      errors.push(`${where}: missing care block`);
      continue;
    }
    if (!(care.check_interval_mins.day > 0 && care.check_interval_mins.night > 0)) errors.push(`${where}: check intervals must be positive`);
    const ambulant = r.mobility.walk_speed_mps > 0;
    const staffMoved = care.transfer_method === "hoist" || care.transfer_method === "none";
    if (ambulant === staffMoved) errors.push(`${where}: walk_speed_mps does not match transfer_method "${care.transfer_method}"`);
    if (care.transfer_method === "hoist" && care.transfer_staff !== 2) errors.push(`${where}: hoist transfers need 2 staff`);
    if (!care.can_request_help && care.reposition_interval_mins.night === null) {
      errors.push(`${where}: a resident who can't ask for help needs scheduled repositioning`);
    }
    if (care.bed_bound && r.routine.wake !== null) errors.push(`${where}: bed-bound residents have no wake time`);
    if (!care.bed_bound && (r.routine.wake === null || r.routine.bed === null)) errors.push(`${where}: needs wake and bed times`);
    if (care.eating_support === "mouth_care_only" && !(care.mouth_care_interval_mins! > 0)) errors.push(`${where}: mouth-care-only residents need mouth_care_interval_mins`);
    if (care.lounge) {
      if (!ambulant) errors.push(`${where}: only residents who can walk have lounge habits`);
      if (care.lounge.likes.length === 0) errors.push(`${where}: lounge likes can't be empty`);
    }
    const relatedVisitor = (id: string | null) => !!id && visitorById.get(id)?.relation_to_resident.some((rel) => rel.resident === r.id);
    if (!relatedVisitor(care.next_of_kin)) errors.push(`${where}: next_of_kin "${care.next_of_kin}" is not one of their visitors`);
    if (r.legal.lpa_health !== null && !relatedVisitor(r.legal.lpa_health)) {
      errors.push(`${where}: lpa_health "${r.legal.lpa_health}" is not one of their visitors`);
    }
  }

  // Staff
  for (const s of staff) {
    const where = `staff ${s.id}`;
    idPrefix(s.id, "stf_", where);
    if (!ROLES.has(s.role)) errors.push(`${where}: unknown role "${s.role}"`);
    if (s.employment !== "permanent" && s.employment !== "bank") errors.push(`${where}: employment must be permanent or bank`);
    for (const c of s.competencies) if (!COMPETENCIES.has(c)) errors.push(`${where}: unknown competency "${c}"`);
    if (!(s.walk_speed_mps > 0)) errors.push(`${where}: walk_speed_mps must be positive`);
    for (const rel of s.relationships) if (!known.has(rel.with)) errors.push(`${where}: relationship with unknown "${rel.with}"`);
  }

  // Visitors
  for (const v of visitors) {
    const where = `visitor ${v.id}`;
    idPrefix(v.id, "vis_", where);
    const residentIds = new Set(residents.map((r) => r.id));
    if (v.relation_to_resident.length === 0) errors.push(`${where}: visits nobody`);
    for (const rel of v.relation_to_resident) if (!residentIds.has(rel.resident)) errors.push(`${where}: unknown resident "${rel.resident}"`);
    const p = v.visit_pattern;
    for (const d of p.days) if (!WEEKDAYS.includes(d)) errors.push(`${where}: bad day "${d}"`);
    const window = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(p.time_window);
    if (!window) errors.push(`${where}: bad time_window "${p.time_window}"`);
    else {
      checkClock(window[1]!, where, errors);
      checkClock(window[2]!, where, errors);
      if (window[1]! >= window[2]!) errors.push(`${where}: time_window must not cross midnight`);
    }
    if (!(p.duration_mins > 0)) errors.push(`${where}: duration_mins must be positive`);
    if (!(p.reliability >= 0 && p.reliability <= 1)) errors.push(`${where}: reliability must be 0..1`);
    if (!(v.walk_speed_mps > 0)) errors.push(`${where}: walk_speed_mps must be positive`);
    if (v.accompanies !== undefined) {
      const lead = visitorById.get(v.accompanies);
      if (!lead) errors.push(`${where}: accompanies unknown "${v.accompanies}"`);
      else {
        if (lead.accompanies !== undefined) errors.push(`${where}: accompanies ${lead.id}, who only visits with someone else`);
        const shared = v.relation_to_resident.some((a) => lead.relation_to_resident.some((b) => a.resident === b.resident));
        if (!shared) errors.push(`${where}: accompanies ${lead.id}, who visits a different resident`);
        if (!p.days.every((d) => lead.visit_pattern.days.includes(d))) errors.push(`${where}: visits on days ${lead.id} doesn't`);
      }
    }
    for (const c of v.conflicts) if (!visitorById.has(c.with)) errors.push(`${where}: conflict with unknown "${c.with}"`);
  }
  for (const r of residents) {
    if (!visitors.some((v) => v.relation_to_resident.some((rel) => rel.resident === r.id))) {
      errors.push(`resident ${r.id}: has no visitors`);
    }
  }

  // Relationship edges
  const pairs = new Set<string>();
  for (const e of relationships) {
    const where = `relationship ${e.from} -> ${e.to}`;
    if (!known.has(e.from)) errors.push(`${where}: unknown "${e.from}"`);
    if (!known.has(e.to)) errors.push(`${where}: unknown "${e.to}"`);
    if (e.from === e.to) errors.push(`${where}: self-relationship`);
    const key = [e.from, e.to].sort().join("|");
    if (pairs.has(key)) errors.push(`${where}: duplicate pair`);
    pairs.add(key);
  }
}

// ---------------------------------------------------------------- rota

function validateRota(data: WorldData, errors: string[]): void {
  const { rota, staff } = data;
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const has = (s: Staff | undefined, c: Competency) => !!s && s.competencies.includes(c);

  for (const [name, shift] of Object.entries(rota.shifts)) {
    checkClock(shift.start, `rota shift ${name}`, errors);
    checkClock(shift.end, `rota shift ${name}`, errors);
  }
  if (rota.agency_pool.carer.length === 0 || rota.agency_pool.nurse.length === 0) errors.push("rota: agency pool is empty");
  if (!rota.night_float.id.startsWith("ext_")) errors.push("rota: night_float id should start with \"ext_\"");
  if (rota.night_float.gender !== "female") errors.push("rota: night_float covers Peggy's female-only care, so must be female");
  for (const t of rota.night_float.rounds) checkClock(t, "rota night_float", errors);
  if (!rota.main_building_carer.id.startsWith("ext_")) errors.push("rota: main_building_carer id should start with \"ext_\"");

  const onDuty = (day: RotaDay) => [day.early.lead, day.early.ca, day.late.lead, day.late.ca, day.night.carer, day.rn_day.nurse];

  WEEKDAYS.forEach((dayName, i) => {
    const day = rota.week[dayName];
    if (!day) {
      errors.push(`rota: missing ${dayName}`);
      return;
    }
    const where = `rota ${dayName}`;

    const careSlots: [string, string][] = [
      ["early.lead", day.early.lead],
      ["early.ca", day.early.ca],
      ["late.lead", day.late.lead],
      ["late.ca", day.late.ca],
      ["night.carer", day.night.carer],
    ];
    for (const [slot, id] of careSlots) {
      if (id === AGENCY) continue;
      const s = staffById.get(id);
      if (!s) errors.push(`${where}: ${slot} is unknown "${id}"`);
      else if (!CARER_ROLES.has(s.role)) errors.push(`${where}: ${slot} ${id} is not a carer`);
    }
    if (day.early.lead === AGENCY || day.late.lead === AGENCY) errors.push(`${where}: shift leads can't be agency`);
    if (!has(staffById.get(day.late.lead), "meds_trained")) errors.push(`${where}: late lead must be meds-trained for the 21:00 round`);
    if (day.rn_day.nurse !== AGENCY && staffById.get(day.rn_day.nurse)?.role !== "registered_nurse") {
      errors.push(`${where}: rn_day must be a registered nurse or agency`);
    }
    for (const id of [...day.office, ...day.reception]) if (!staffById.has(id)) errors.push(`${where}: unknown office/reception staff "${id}"`);

    // Peggy has female carers only for personal care, so every day shift needs a woman on it.
    for (const shift of ["early", "late"] as const) {
      const carers = [day[shift].lead, day[shift].ca].map((id) => staffById.get(id));
      if (!carers.some((s) => s?.gender === "female")) errors.push(`${where}: the ${shift} shift has no female carer (Peggy's personal care)`);
    }

    const named = onDuty(day).filter((id) => id !== AGENCY);
    for (const id of duplicates(named)) errors.push(`${where}: ${id} is on two shifts`);

    // 11 hours' rest (Working Time Regulations): a late ends 21:30, so no early or RN day next
    // morning; a night ends 07:15 next day, so no day shift at all next day.
    const next = rota.week[WEEKDAYS[(i + 1) % 7]!];
    if (next) {
      const nextMorning = [next.early.lead, next.early.ca, next.rn_day.nurse];
      const nextDay = [...nextMorning, next.late.lead, next.late.ca];
      for (const id of [day.late.lead, day.late.ca]) {
        if (id !== AGENCY && nextMorning.includes(id)) errors.push(`${where}: ${id} works a late then an early next day`);
      }
      const nightCarer = day.night.carer;
      if (nightCarer !== AGENCY && nextDay.includes(nightCarer)) errors.push(`${where}: ${nightCarer} works a night then a day shift`);
    }
  });
}

// ---------------------------------------------------------------- the building (v1.0-testbed)

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const WEATHER_RANGES: Record<string, [number, number]> = {
  tempC: [-40, 50],
  humidityPct: [0, 100],
  dewPointC: [-50, 40],
  precipMm: [0, 200],
  cloudPct: [0, 100],
  windMps: [0, 70],
  windDirDeg: [0, 360],
  shortwaveWm2: [0, 1400],
  pressureHpa: [850, 1100],
};

function validateBuilding(data: WorldData, errors: string[]): void {
  const fp = data.floorplan;
  const rooms = new Map(fp.rooms.map((r) => [r.id, r]));
  const walls = new Map(fp.walls.map((w) => [w.id, w]));
  const inAnyRoom = (x: number, y: number) => fp.rooms.some((r) => inside(x, y, r.rect));

  for (const w of fp.windows) {
    const room = rooms.get(w.room);
    const wall = walls.get(w.wall);
    if (!room) errors.push(`floorplan: window ${w.id} is in unknown room "${w.room}"`);
    if (!wall) errors.push(`floorplan: window ${w.id} is on unknown wall "${w.wall}"`);
    if (!room || !wall) continue;
    const horizontal = Math.abs(w.y1 - w.y2) < EPS;
    const span = { x: Math.min(w.x1, w.x2), y: Math.min(w.y1, w.y2), w: Math.abs(w.x2 - w.x1), h: Math.abs(w.y2 - w.y1) };
    const wallRect = { x: Math.min(wall.x1, wall.x2), y: Math.min(wall.y1, wall.y2), w: Math.abs(wall.x2 - wall.x1), h: Math.abs(wall.y2 - wall.y1) };
    if (!rectWithin(span, wallRect)) errors.push(`floorplan: window ${w.id} does not lie on wall ${w.wall}`);
    if (!onRectEdge({ ...w, id: w.id, wall: w.wall, rooms: [w.room, "Outside"] }, room.rect)) errors.push(`floorplan: window ${w.id} is not on the edge of ${w.room}`);
    // An outer wall: just beyond the window, away from its room, there's no room.
    const mx = (w.x1 + w.x2) / 2;
    const my = (w.y1 + w.y2) / 2;
    const away = horizontal ? (my <= room.rect.y + EPS ? -0.25 : 0.25) : mx <= room.rect.x + EPS ? -0.25 : 0.25;
    if (horizontal ? inAnyRoom(mx, my + away) : inAnyRoom(mx + away, my)) errors.push(`floorplan: window ${w.id} isn't on an outer wall`);
    for (const d of fp.doors.filter((d) => d.wall === w.wall)) {
      const overlap = horizontal
        ? Math.min(Math.max(d.x1, d.x2), Math.max(w.x1, w.x2)) - Math.max(Math.min(d.x1, d.x2), Math.min(w.x1, w.x2))
        : Math.min(Math.max(d.y1, d.y2), Math.max(w.y1, w.y2)) - Math.max(Math.min(d.y1, d.y2), Math.min(w.y1, w.y2));
      if (overlap > EPS) errors.push(`floorplan: window ${w.id} overlaps door ${d.id}`);
    }
  }

  // Equipment (PR 2): in its room; every room has a light; every en-suite its WC, basin and shower.
  const KINDS = new Set(["light", "heating", "tv", "kettle", "wc", "basin", "shower"]);
  for (const e of fp.equipment) {
    const room = rooms.get(e.room);
    if (!KINDS.has(e.kind)) errors.push(`floorplan: equipment ${e.id} has unknown kind "${e.kind}"`);
    if (!room) errors.push(`floorplan: equipment ${e.id} is in unknown room "${e.room}"`);
    else if (!inside(e.x, e.y, room.rect)) errors.push(`floorplan: equipment ${e.id} is not inside ${e.room}`);
  }
  for (const r of fp.rooms) {
    if (!fp.equipment.some((e) => e.kind === "light" && e.room === r.id)) errors.push(`floorplan: room ${r.id} has no light`);
    if (r.kind === "ensuite") for (const k of ["wc", "basin", "shower"]) if (!fp.equipment.some((e) => e.kind === k && e.room === r.id)) errors.push(`floorplan: en-suite ${r.id} has no ${k}`);
    if (fp.equipment.some((e) => e.kind === "heating" && e.room === r.id) && !(data.building.heating.setpoint_c[r.kind] > 0)) errors.push(`building: no heating set point for ${r.kind} rooms (${r.id})`);
  }
  const md = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  for (const d of data.building.heating.season) if (!md.test(d)) errors.push(`building: heating.season "${d}" must be MM-DD`);
  for (const c of data.building.lights.corridor_dim) checkClock(c, "building: lights.corridor_dim", errors);
  if (!(data.building.lights.dark_below_wm2 >= 0)) errors.push("building: lights.dark_below_wm2 must be 0 or more");
  if (!(data.building.kettle_mins > 0)) errors.push("building: kettle_mins must be more than 0");

  // Every door is a bedroom or en-suite door, or in exactly one list in data/building.json.
  const b = data.building;
  const kind = (id: string) => rooms.get(id)?.kind;
  const lists: [string, string[]][] = [["held_open_by_day", b.doors.held_open_by_day], ["closed", b.doors.closed], ["locked", b.doors.locked]];
  for (const [name, ids] of lists) for (const id of ids) if (!fp.doors.some((d) => d.id === id)) errors.push(`building: ${name} lists unknown door "${id}"`);
  for (const d of fp.doors) {
    const own = d.rooms.some((r) => kind(r) === "ensuite") || (d.rooms.some((r) => kind(r) === "bedroom") && d.rooms.includes("Corridor"));
    const listed = lists.filter(([, ids]) => ids.includes(d.id)).length;
    if (!own && listed !== 1) errors.push(`building: door ${d.id} needs exactly one rule in data/building.json (held_open_by_day, closed or locked), found ${listed}`);
    if (own && listed > 0) errors.push(`building: door ${d.id} is a bedroom or en-suite door, which has its own rules; take it out of data/building.json`);
  }
  for (const c of b.doors.closed_overnight) checkClock(c, "building: doors.closed_overnight", errors);
  for (const c of [b.windows.close_by, b.windows.lounge_from]) checkClock(c, "building: windows", errors);
  if (!(b.windows.max_opening_mm > 0)) errors.push("building: windows.max_opening_mm must be more than 0");
  if (!(b.windows.close_after_mins > 0)) errors.push("building: windows.close_after_mins must be more than 0");

  // Each card's night-time door: a reason whenever it isn't the default (closed).
  for (const r of data.residents) {
    const pref = r.care.door_at_night;
    if (pref !== undefined && !["open", "ajar", "closed"].includes(pref)) errors.push(`${r.id}: door_at_night must be open, ajar or closed`);
    if (pref && pref !== "closed" && !r.care.door_at_night_reason) errors.push(`${r.id}: door_at_night "${pref}" needs a door_at_night_reason`);
  }

  // Every activity the engine can give has an entry, ending with one that always fits.
  const groups: [string, readonly string[], Record<string, unknown[]>][] = [
    ["resident", RESIDENT_ACTIVITIES, data.activities.resident],
    ["other", OTHER_ACTIVITIES, data.activities.other],
  ];
  for (const [group, needed, table] of groups) {
    for (const a of needed) {
      const entries = data.activities[group as "resident" | "other"][a];
      if (!entries || entries.length === 0) {
        errors.push(`activities: no ${group} entry for "${a}"`);
        continue;
      }
      const last = entries[entries.length - 1]!;
      if (last.aid !== undefined || last.below_mps !== undefined || last.in_bed !== undefined) errors.push(`activities: ${group} "${a}" needs a last entry with no conditions`);
      for (const e of entries) if (!(e.met > 0) || !e.code || !["older", "adult"].includes(e.book)) errors.push(`activities: ${group} "${a}" has an entry without a book, code and MET`);
    }
    for (const a of Object.keys(table)) if (!needed.includes(a)) errors.push(`activities: ${group} "${a}" isn't an activity the engine gives`);
  }

  // The weather: every hour, in order, from `from` 00:00 to `to` 23:00, covering a whole year.
  const w = data.weather;
  if (!w) return;
  let [y, m, d] = w.from.split("-").map(Number) as [number, number, number];
  let h = 0;
  const seen = new Set<string>();
  for (const [i, hour] of w.hours.entries()) {
    const expected = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00`;
    if (hour.time !== expected) {
      errors.push(`weather: hour ${i} is ${hour.time}, expected ${expected}`);
      return;
    }
    seen.add(hour.time.slice(5, 10));
    for (const [field, [lo, hi]] of Object.entries(WEATHER_RANGES)) {
      const v = (hour as unknown as Record<string, number>)[field];
      if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) errors.push(`weather: ${hour.time} ${field} ${v} is out of range ${lo} to ${hi}`);
    }
    h += 1;
    if (h === 24) {
      h = 0;
      d += 1;
      if (d > daysIn(y, m)) (d = 1), (m += 1);
      if (m > 12) (m = 1), (y += 1);
    }
  }
  if (w.hours.at(-1)?.time !== `${w.to}T23:00`) errors.push(`weather: the last hour should be ${w.to}T23:00`);
  for (let month = 1; month <= 12; month++)
    for (let day = 1; day <= daysIn(2025, month); day++) {
      const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (!seen.has(key)) errors.push(`weather: no hours for ${key}: the data must cover a whole year`);
    }
}

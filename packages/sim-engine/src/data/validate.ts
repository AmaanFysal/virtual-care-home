// Checks the static data in `data/` for broken references, impossible geometry and rota
// rule breaches. Pure: takes parsed data, returns a list of human-readable errors.

import {
  AGENCY,
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

const EPS = 1e-6;

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
    ["furniture", fp.furniture],
    ["point", fp.points],
  ] as const) {
    for (const id of duplicates(list.map((item) => item.id))) errors.push(`floorplan: duplicate ${label} id "${id}"`);
  }

  const rooms = new Map(fp.rooms.map((r) => [r.id, r]));
  const walls = new Map(fp.walls.map((w) => [w.id, w]));
  const bounds: Rect = { x: 0, y: 0, w: fp.size.w, h: fp.size.h };

  for (const room of fp.rooms) {
    if (!rectWithin(room.rect, bounds)) errors.push(`floorplan: room ${room.id} is outside the wing`);
    if (Math.abs(room.floor_area_m2 - room.rect.w * room.rect.h) > 0.01) {
      errors.push(`floorplan: room ${room.id} floor_area_m2 ${room.floor_area_m2} does not match its rect`);
    }
    if (!(room.ceiling_height_m > 0)) errors.push(`floorplan: room ${room.id} needs a ceiling height`);
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
    for (const roomId of door.rooms) {
      if (roomId === "Outside") continue;
      const room = rooms.get(roomId);
      if (!room) errors.push(`floorplan: door ${door.id} connects unknown room "${roomId}"`);
      else if (!onRectEdge(door, room.rect)) errors.push(`floorplan: door ${door.id} is not on the edge of ${roomId}`);
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
      const expected = bed.room === "Room1" ? "female" : "male";
      if (r.gender !== expected) errors.push(`${where}: ${bed.room} is a ${expected} room`);
    }
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

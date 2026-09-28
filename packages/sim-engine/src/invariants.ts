// Per-tick invariants (spec "Invariants", docs/11). The engine logs `invariant.violated` when a
// rule starts failing; tests call `checkInvariants` directly every tick. Rules for meds, falls
// and check intervals arrive with the procedures that need them (M4b, M5).

import { cellAt } from "./world/grid.js";
import { floorCovered } from "./floor.js";
import { isNurse, onDuty, type World } from "./state.js";

export interface Violation {
  rule: string;
  details: string;
}

export function checkInvariants(world: World): Violation[] {
  const out: Violation[] = [];
  const people = world.order.map((id) => world.people.get(id)!);

  if (!floorCovered(world)) out.push({ rule: "floor_cover", details: "no on-duty care staff on the floor" });

  // Standing spots: nobody shares a cell while stationary.
  const byCell = new Map<number, string[]>();
  for (const p of people) {
    if (!p.onMap || p.move) continue;
    const cell = cellAt(world.grid, p.x, p.y);
    byCell.set(cell, [...(byCell.get(cell) ?? []), p.id]);
  }
  for (const [cell, ids] of byCell) {
    if (ids.length > 1) out.push({ rule: "standing_spot", details: `${ids.join(", ")} share cell ${cell}` });
  }

  // Two-person care is only ever carried out with two staff at the resident.
  for (const task of world.tasks.values()) {
    if (task.staffNeeded !== 2 || task.data.phase !== "performing") continue;
    const resident = world.people.get(task.residentId!)!;
    const near = task.assigned.filter((id) => {
      const s = world.people.get(id)!;
      return s.onMap && !s.move && Math.hypot(s.x - resident.x, s.y - resident.y) <= 2.5;
    });
    if (near.length < 2) out.push({ rule: "two_person", details: `${task.id} (${task.label}) with ${near.length} staff` });
  }

  if (!world.rnOnCall && !people.some((p) => isNurse(p) && onDuty(p))) out.push({ rule: "rn_reachable", details: "no RN on the map and none on call" });

  for (const p of people) {
    if (p.kind === "visitor" && p.onMap && p.roomId === "StaffRoom") out.push({ rule: "no_visitors_in_staff_room", details: p.id });
  }
  return out;
}

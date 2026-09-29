// The floor rule (spec decision 4): at every tick at least one on-duty care staff member is
// inside the wing, outside the staff room, and not on a break. A sole night carer's break is
// taken in the wing and is interruptible, so it still counts.

import { isCareStaff, isNurse, onDuty, type Person, type World } from "./state.js";

export function onBreak(world: World, p: Person): boolean {
  const task = p.staff?.taskId ? world.tasks.get(p.staff.taskId) : undefined;
  return task?.kind === "break";
}

export function breakInterruptible(world: World, p: Person): boolean {
  const task = p.staff?.taskId ? world.tasks.get(p.staff.taskId) : undefined;
  return task?.kind === "break" && task.data.interruptible === 1;
}

export function onFloor(world: World, p: Person): boolean {
  if (!isCareStaff(p) || !onDuty(p) || p.roomId === "StaffRoom" || p.roomId === null) return false;
  return !onBreak(world, p) || breakInterruptible(world, p);
}

/**
 * Whether someone other than `p` is covering the floor. With `carersOnly`, the RN doesn't count:
 * breaks are staggered between carers so the nurse isn't left alone on the floor with the meds.
 */
export function coveredWithout(world: World, p: Person, carersOnly = false, ignore: Set<string> = new Set()): boolean {
  for (const id of world.order) {
    const q = world.people.get(id)!;
    if (q.id !== p.id && !ignore.has(q.id) && onFloor(world, q) && !(carersOnly && isNurse(q))) return true;
  }
  return false;
}

export function floorCovered(world: World): boolean {
  return world.order.some((id) => onFloor(world, world.people.get(id)!));
}

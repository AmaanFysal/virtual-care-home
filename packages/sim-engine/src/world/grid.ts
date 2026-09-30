// Hidden navigation grid derived from the floor plan (docs/02 "Navigation grid").
// Cells are 0.5 m; walls lie on cell boundaries and block moves across them except
// through door gaps. Doorway cells (either side of a gap) form single-occupancy zones.

import type { FloorPlan, NamedPoint } from "@vch/shared-types";

const EPS = 1e-6;

export interface Grid {
  cols: number;
  rows: number;
  cell: number;
  /** Room id per cell index, or null outside every room. */
  roomOf: (string | null)[];
  walkable: boolean[];
  /** Door id per cell index for doorway cells, else null. */
  doorZoneOf: (string | null)[];
  /** Door ids in data order, with their doorway cells. */
  doorZones: Map<string, number[]>;
  /** Blocked edges between orthogonal neighbours, keyed by `edgeKey`. */
  blockedEdges: Set<string>;
}

export function cellIndex(grid: Grid, col: number, row: number): number {
  return row * grid.cols + col;
}

export function cellAt(grid: Grid, x: number, y: number): number {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / grid.cell)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(y / grid.cell)));
  return cellIndex(grid, col, row);
}

export function cellCentre(grid: Grid, index: number): { x: number; y: number } {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return { x: (col + 0.5) * grid.cell, y: (row + 0.5) * grid.cell };
}

export function pointCell(grid: Grid, point: NamedPoint): number {
  return cellAt(grid, point.x, point.y);
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function between(v: number, lo: number, hi: number): boolean {
  return v > Math.min(lo, hi) - EPS && v < Math.max(lo, hi) + EPS;
}

export function buildGrid(plan: FloorPlan): Grid {
  const cell = plan.grid_cell_m;
  const cols = Math.round(plan.size.w / cell);
  const rows = Math.round(plan.size.h / cell);
  const count = cols * rows;
  const grid: Grid = {
    cols,
    rows,
    cell,
    roomOf: new Array<string | null>(count).fill(null),
    walkable: new Array<boolean>(count).fill(false),
    doorZoneOf: new Array<string | null>(count).fill(null),
    doorZones: new Map(),
    blockedEdges: new Set(),
  };

  const blockers = plan.furniture.filter((f) => f.blocks);
  for (let i = 0; i < count; i++) {
    const { x, y } = cellCentre(grid, i);
    // The innermost room wins: a cell in an en-suite belongs to the en-suite, not the bedroom around it.
    const room = plan.rooms
      .filter((r) => x > r.rect.x && x < r.rect.x + r.rect.w && y > r.rect.y && y < r.rect.y + r.rect.h)
      .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
    grid.roomOf[i] = room?.id ?? null;
    const blocked = blockers.some((f) => x > f.rect.x && x < f.rect.x + f.rect.w && y > f.rect.y && y < f.rect.y + f.rect.h);
    grid.walkable[i] = !!room && !blocked;
  }

  // A cell edge is open if it doesn't lie along a wall, or lies inside a door gap on that wall.
  const inDoorGap = (x1: number, y1: number, x2: number, y2: number): boolean =>
    plan.doors.some((d) => {
      if (Math.abs(d.y1 - d.y2) < EPS) {
        return Math.abs(y1 - d.y1) < EPS && Math.abs(y2 - d.y1) < EPS && between(x1, d.x1, d.x2) && between(x2, d.x1, d.x2);
      }
      return Math.abs(x1 - d.x1) < EPS && Math.abs(x2 - d.x1) < EPS && between(y1, d.y1, d.y2) && between(y2, d.y1, d.y2);
    });
  const onWall = (x1: number, y1: number, x2: number, y2: number): boolean =>
    plan.walls.some((w) => {
      if (Math.abs(w.y1 - w.y2) < EPS) {
        return Math.abs(y1 - w.y1) < EPS && Math.abs(y2 - w.y1) < EPS && between(x1, w.x1, w.x2) && between(x2, w.x1, w.x2);
      }
      return Math.abs(x1 - w.x1) < EPS && Math.abs(x2 - w.x1) < EPS && between(y1, w.y1, w.y2) && between(y2, w.y1, w.y2);
    });

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = cellIndex(grid, col, row);
      if (col + 1 < cols) {
        // Shared vertical edge at x = (col+1)*cell.
        const x = (col + 1) * cell;
        if (onWall(x, row * cell, x, (row + 1) * cell) && !inDoorGap(x, row * cell, x, (row + 1) * cell)) {
          grid.blockedEdges.add(edgeKey(a, cellIndex(grid, col + 1, row)));
        }
      }
      if (row + 1 < rows) {
        // Shared horizontal edge at y = (row+1)*cell.
        const y = (row + 1) * cell;
        if (onWall(col * cell, y, (col + 1) * cell, y) && !inDoorGap(col * cell, y, (col + 1) * cell, y)) {
          grid.blockedEdges.add(edgeKey(a, cellIndex(grid, col, row + 1)));
        }
      }
    }
  }

  // Doorway zones: the cells either side of each gap, inside the wing.
  for (const d of plan.doors) {
    const cells: number[] = [];
    if (Math.abs(d.y1 - d.y2) < EPS) {
      const edgeRow = Math.round(d.y1 / cell);
      for (let col = Math.round(Math.min(d.x1, d.x2) / cell); col < Math.round(Math.max(d.x1, d.x2) / cell); col++) {
        for (const row of [edgeRow - 1, edgeRow]) if (row >= 0 && row < rows) cells.push(cellIndex(grid, col, row));
      }
    } else {
      const edgeCol = Math.round(d.x1 / cell);
      for (let row = Math.round(Math.min(d.y1, d.y2) / cell); row < Math.round(Math.max(d.y1, d.y2) / cell); row++) {
        for (const col of [edgeCol - 1, edgeCol]) if (col >= 0 && col < cols) cells.push(cellIndex(grid, col, row));
      }
    }
    const zone = cells.filter((c) => grid.walkable[c]).sort((a, b) => a - b);
    grid.doorZones.set(d.id, zone);
    for (const c of zone) grid.doorZoneOf[c] = d.id;
  }

  return grid;
}

/** Orthogonal move between neighbours a and b is allowed. */
export function orthOpen(grid: Grid, a: number, b: number): boolean {
  return grid.walkable[a]! && grid.walkable[b]! && !grid.blockedEdges.has(edgeKey(a, b));
}

/** Walkable neighbours of a cell (8-connected, no corner-cutting), in a fixed order. */
export function neighbours(grid: Grid, index: number): { cell: number; cost: number }[] {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  const out: { cell: number; cost: number }[] = [];
  const at = (c: number, r: number) => (c >= 0 && c < grid.cols && r >= 0 && r < grid.rows ? cellIndex(grid, c, r) : -1);
  for (const [dc, dr] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    const n = at(col + dc, row + dr);
    if (n >= 0 && orthOpen(grid, index, n)) out.push({ cell: n, cost: 1 });
  }
  for (const [dc, dr] of [
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const n = at(col + dc, row + dr);
    const h = at(col + dc, row);
    const v = at(col, row + dr);
    if (n < 0 || h < 0 || v < 0) continue;
    if (orthOpen(grid, index, h) && orthOpen(grid, h, n) && orthOpen(grid, index, v) && orthOpen(grid, v, n)) {
      out.push({ cell: n, cost: Math.SQRT2 });
    }
  }
  return out;
}

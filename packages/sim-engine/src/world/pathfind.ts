// A* on the navigation grid (docs/04). 8-connected with no corner-cutting, octile heuristic,
// and deterministic tie-breaking (f, then h, then cell index) so runs are reproducible.

import { neighbours, type Grid } from "./grid.js";

const adjacencyCache = new WeakMap<Grid, { cell: number; cost: number }[][]>();

function adjacency(grid: Grid): { cell: number; cost: number }[][] {
  let adj = adjacencyCache.get(grid);
  if (!adj) {
    adj = grid.walkable.map((_, i) => (grid.walkable[i] ? neighbours(grid, i) : []));
    adjacencyCache.set(grid, adj);
  }
  return adj;
}

function octile(grid: Grid, a: number, b: number): number {
  const dx = Math.abs((a % grid.cols) - (b % grid.cols));
  const dy = Math.abs(Math.floor(a / grid.cols) - Math.floor(b / grid.cols));
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

interface Node {
  cell: number;
  f: number;
  h: number;
}

function less(a: Node, b: Node): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.cell < b.cell;
}

class Heap {
  private items: Node[] = [];
  get size(): number {
    return this.items.length;
  }
  push(node: Node): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }
  pop(): Node {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < items.length && less(items[l]!, items[best]!)) best = l;
        if (r < items.length && less(items[r]!, items[best]!)) best = r;
        if (best === i) break;
        [items[i], items[best]] = [items[best]!, items[i]!];
        i = best;
      }
    }
    return top;
  }
}

/** Cells from start to goal inclusive, or null if unreachable. */
export function findPath(grid: Grid, start: number, goal: number): number[] | null {
  if (!grid.walkable[start] || !grid.walkable[goal]) return null;
  if (start === goal) return [start];
  const adj = adjacency(grid);
  const g = new Float64Array(grid.walkable.length).fill(Infinity);
  const from = new Int32Array(grid.walkable.length).fill(-1);
  const closed = new Uint8Array(grid.walkable.length);
  const open = new Heap();
  g[start] = 0;
  open.push({ cell: start, f: octile(grid, start, goal), h: octile(grid, start, goal) });

  while (open.size > 0) {
    const { cell } = open.pop();
    if (closed[cell]) continue;
    if (cell === goal) {
      const path = [goal];
      for (let c = from[goal]!; c !== -1; c = from[c]!) path.push(c);
      return path.reverse();
    }
    closed[cell] = 1;
    for (const n of adj[cell]!) {
      if (closed[n.cell]) continue;
      const cost = g[cell]! + n.cost;
      if (cost < g[n.cell]! - 1e-9) {
        g[n.cell] = cost;
        from[n.cell] = cell;
        const h = octile(grid, n.cell, goal);
        open.push({ cell: n.cell, f: cost + h, h });
      }
    }
  }
  return null;
}

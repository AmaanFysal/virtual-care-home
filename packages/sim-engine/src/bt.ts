// A small behaviour-tree runtime (docs/04). Trees are static TypeScript definitions; each
// running instance keeps only plain data (child cursors and per-leaf memory), so task state
// stays serialisable. Composites have memory: a sequence resumes at the child it was on.

export type Status = "running" | "success" | "failure";

export interface BtState {
  /** Current child index per composite, keyed by node path. */
  cursor: Record<string, number>;
  /** Per-leaf memory, keyed by node path. */
  mem: Record<string, number>;
  /** Name of the last leaf that ran (shown in the inspector). */
  node: string | null;
}

export interface Leaf<C> {
  type: "leaf";
  name: string;
  /** `mem` is this leaf's own memory; it is cleared when the leaf finishes. */
  tick: (ctx: C, mem: Record<string, number>) => Status;
}

export interface Composite<C> {
  type: "seq" | "sel";
  name: string;
  children: BtNode<C>[];
}

export type BtNode<C> = Leaf<C> | Composite<C>;

export function newBtState(): BtState {
  return { cursor: {}, mem: {}, node: null };
}

/** Runs children in order; fails as soon as one fails. */
export function seq<C>(name: string, ...children: BtNode<C>[]): Composite<C> {
  return { type: "seq", name, children };
}

/** Tries children in order; succeeds as soon as one succeeds. */
export function sel<C>(name: string, ...children: BtNode<C>[]): Composite<C> {
  return { type: "sel", name, children };
}

export function leaf<C>(name: string, tick: Leaf<C>["tick"]): Leaf<C> {
  return { type: "leaf", name, tick };
}

/** Instant action. */
export function act<C>(name: string, fn: (ctx: C) => void): Leaf<C> {
  return leaf(name, (ctx) => (fn(ctx), "success"));
}

/** Instant check. */
export function cond<C>(name: string, test: (ctx: C) => boolean): Leaf<C> {
  return leaf(name, (ctx) => (test(ctx) ? "success" : "failure"));
}

/** Keeps running until the test passes. */
export function until<C>(name: string, test: (ctx: C) => boolean): Leaf<C> {
  return leaf(name, (ctx) => (test(ctx) ? "success" : "running"));
}

function readMem(state: BtState, path: string): Record<string, number> {
  const prefix = `${path}#`;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.mem)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

function writeMem(state: BtState, path: string, mem: Record<string, number> | null): void {
  const prefix = `${path}#`;
  for (const k of Object.keys(state.mem)) if (k.startsWith(prefix)) delete state.mem[k];
  if (mem) for (const [k, v] of Object.entries(mem)) state.mem[prefix + k] = v;
}

function run<C>(node: BtNode<C>, path: string, ctx: C, state: BtState): Status {
  if (node.type === "leaf") {
    const mem = readMem(state, path);
    const status = node.tick(ctx, mem);
    writeMem(state, path, status === "running" ? mem : null);
    state.node = node.name;
    return status;
  }
  let i = state.cursor[path] ?? 0;
  while (i < node.children.length) {
    const status = run(node.children[i]!, `${path}/${i}`, ctx, state);
    if (status === "running") {
      state.cursor[path] = i;
      return "running";
    }
    const done = node.type === "seq" ? status === "failure" : status === "success";
    if (done) {
      delete state.cursor[path];
      return status;
    }
    i += 1;
  }
  delete state.cursor[path];
  return node.type === "seq" ? "success" : "failure";
}

/** Advances a tree by one tick. */
export function tickTree<C>(root: BtNode<C>, ctx: C, state: BtState): Status {
  return run(root, root.name, ctx, state);
}

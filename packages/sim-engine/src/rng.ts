// Seeded randomness (docs/03). sfc32 seeded by xmur3; one independent stream per system,
// so a new draw in one system never shifts another system's sequence.

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** xmur3 string hash; returns a generator of 32-bit seeds. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function createRng(seed: string): Rng {
  const seedGen = xmur3(seed);
  let a = seedGen();
  let b = seedGen();
  let c = seedGen();
  let d = seedGen();

  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from empty list");
      return items[Math.floor(next() * items.length)]!;
    },
  };
}

// "director" is drawn only by the scenario director's daily plans, and "cover" only by the cover
// rule for absences (docs/10), so with the director off and no absences neither is used, and the
// director's plans don't shift when how cover plays out changes.
export const STREAMS = ["rota", "visitors", "needs", "decisions", "meds", "falls", "movement", "director", "cover"] as const;
export type StreamName = (typeof STREAMS)[number];

export function createStreams(seed: string): Record<StreamName, Rng> {
  return Object.fromEntries(STREAMS.map((name) => [name, createRng(`${seed}/${name}`)])) as Record<StreamName, Rng>;
}

/** Stable 32-bit FNV-1a hash as 8 hex chars (used for the data version). */
export function hashString(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Deterministic PRNG: xoshiro128** seeded via splitmix32.
// RngState is plain data so it can live inside SimState and be serialised.

export type RngState = [number, number, number, number];

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const next = splitmix32(seed);
  const st: RngState = [next(), next(), next(), next()];
  if ((st[0] | st[1] | st[2] | st[3]) === 0) st[0] = 1;
  return st;
}

/**
 * An independent stream per purpose: FNV-1a over the seed and key parts. Game rolls key on what they are about
 * (day, change label, workload) so one roll never shifts another, and runs that differ in one action stay paired.
 */
export function streamRng(seed: number, ...key: readonly (string | number)[]): Rng {
  let h = 0x811c9dc5;
  for (const ch of `${seed}|${key.join('|')}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return new Rng(seedRng(h));
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Mutable cursor over a copy of an RngState. Call snapshot() to persist. */
export class Rng {
  private s: RngState;

  constructor(state: RngState) {
    this.s = [state[0], state[1], state[2], state[3]];
  }

  snapshot(): RngState {
    return [this.s[0], this.s[1], this.s[2], this.s[3]];
  }

  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  int(loInclusive: number, hiExclusive: number): number {
    return loInclusive + Math.floor(this.float() * (hiExclusive - loInclusive));
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Standard normal via Box-Muller (no cached spare, keeps state trivially serialisable). */
  normal(): number {
    let u = this.float();
    if (u < 1e-12) u = 1e-12;
    const v = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Weighted pick; weights need not sum to 1. */
  pickWeighted<T>(items: readonly T[], weight: (t: T) => number): T | undefined {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let r = this.float() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }
}

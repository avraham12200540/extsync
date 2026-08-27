import crypto from "node:crypto";

/**
 * mulberry32 - a small, fast, deterministic PRNG. Given the same 32-bit
 * seed it always produces the same sequence, which is exactly the
 * property daily-challenge construction needs (see daily-challenge.ts):
 * "same seed -> same selection" for everyone, every time.
 */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Takes the first 8 hex chars (32 bits) of a hash-derived seed string as the PRNG's numeric seed. */
export function seedHexToUint32(seedHex: string): number {
  return parseInt(seedHex.slice(0, 8), 16) >>> 0;
}

/**
 * A cryptographically-sourced random() in [0,1) - for free-play selection,
 * which must NOT be reproducible/predictable the way the daily seed is.
 * Never Math.random() (not cryptographically strong) and never the
 * deterministic mulberry32 PRNG above.
 */
export function cryptoRandom(): number {
  return crypto.randomBytes(4).readUInt32BE(0) / 0x100000000;
}

/** Sampling without replacement, driven entirely by the injected `random` - deterministic or crypto-random depending on what's passed in. */
export function pickWithoutReplacement<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(random() * pool.length);
    picked.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return picked;
}

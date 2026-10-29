/**
 * Deterministic PRNG utilities for @astram/turboquant.
 *
 * Everything quantization-related in this package is seeded so that the same
 * seed always produces the same rotation Π, the same QJL sign matrix S and the
 * same behavioral-feature tail noise (AGENTS.md "Deterministic where possible").
 */

/**
 * mulberry32 — small, fast, well-mixed 32-bit PRNG returning floats in [0, 1).
 * Seeded from a 32-bit integer; the same seed yields the identical stream.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashF64 = new Float64Array(1);
const hashU32 = new Uint32Array(hashF64.buffer);

/**
 * Hash an array of numbers to a 32-bit seed (FNV-1a over the raw IEEE-754
 * double bits, with an avalanche finalizer). Used by buildBehaviorVector to
 * derive the deterministic tail noise. NaN canonicalizes to 0.
 */
export function hashToSeed32(values: ArrayLike<number>): number {
  let h = 0x811c9dc5;
  const n = values.length;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    hashF64[0] = Number.isNaN(v) ? 0 : v;
    for (let w = 0; w < 2; w++) {
      const word = hashU32[w];
      for (let k = 0; k < 4; k++) {
        h ^= (word >>> (8 * k)) & 0xff;
        h = Math.imul(h, 0x01000193);
      }
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * QJL sign projection: z = sign(S·r), 1536 bits → 192 bytes.
 *
 * CONTRACTS §8 defines S as a seeded ±1/√d matrix. The original build plan
 * proposed materializing a dense i.i.d. 2048×2048 Int8Array S and computing
 * sign(S·r) as 1536 dense dot products — measured on this machine (Node 22,
 * Win x64) that dense apply alone costs ~2.2 ms per record, which alone busts
 * the < 2 ms append budget (see docs/error-log/turboquant-worker.md).
 *
 * Implementation instead: S is a seeded ±1-ENTRY matrix with Hadamard
 * structure, S = (1/√n)·T2·H_2048·T1, where T1/T2 are seeded ±1 diagonal sign
 * flips derived from a stream INDEPENDENT of the Π stream. Every entry of S is
 * exactly ±1/√n (the scale is irrelevant to the sign), the matrix is seeded
 * (different seed → different signs, asserted in tests), and the apply is the
 * same O(n log n) FWHT used for Π (~13 µs). Hadamard-preconditioned sign
 * embeddings are the standard practical QJL/sim-hash construction.
 *
 * As with Π: r is zero-padded to 2048 and the first 1536 rows of S·r give the
 * stored signs (rows/cols beyond 1536 never influence the result because the
 * padding is zero).
 */

import { mulberry32 } from './prng.js';
import { fwhtInPlace, TQ_PAD_DIM } from './orthogonal.js';

const QJL_STREAM_MIX = 0x5eed51d5;

function mixSeed(seed: number): number {
  let h = (seed ^ QJL_STREAM_MIX) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

interface QjlSigns {
  readonly t1: Int8Array;
  readonly t2: Int8Array;
}

const qjlCache = new Map<number, QjlSigns>();

function getQjlSigns(seed: number): QjlSigns {
  const key = seed >>> 0;
  const hit = qjlCache.get(key);
  if (hit !== undefined) return hit;
  if (qjlCache.size > 8) qjlCache.clear();
  const rng = mulberry32(mixSeed(key));
  const t1 = new Int8Array(TQ_PAD_DIM);
  const t2 = new Int8Array(TQ_PAD_DIM);
  for (let i = 0; i < TQ_PAD_DIM; i++) t1[i] = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < TQ_PAD_DIM; i++) t2[i] = rng() < 0.5 ? -1 : 1;
  const signs: QjlSigns = { t1, t2 };
  qjlCache.set(key, signs);
  return signs;
}

const qjlScratch = new Float64Array(TQ_PAD_DIM);

/**
 * Compute z = sign(S·r) for a 1536-dim residual `r`, packing the 1536 sign
 * bits LSB-first into `out` (192 bytes). Sign convention: bit 1 ⇔ (S·r)_i > 0;
 * exact zeros (measure zero) resolve deterministically to bit 0.
 */
export function computeQjlSigns(r: ArrayLike<number>, seed: number, out: Uint8Array): void {
  const { t1, t2 } = getQjlSigns(seed);
  const s = qjlScratch;
  s.fill(0);
  for (let i = 0; i < 1536; i++) s[i] = r[i] * t1[i];
  fwhtInPlace(s);
  // (S·r)_i = t2_i · (H·(T1·r_pad))_i / √n — take the sign of the first 1536.
  for (let byte = 0, i = 0; byte < 192; byte++) {
    let b = 0;
    for (let bit = 0; bit < 8; bit++, i++) {
      if (s[i] * t2[i] > 0) b |= 1 << bit;
    }
    out[byte] = b;
  }
}

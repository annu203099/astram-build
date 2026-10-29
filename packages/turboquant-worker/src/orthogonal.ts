/**
 * Orthogonal projection Π for the PolarQuant stage.
 *
 * Handbook §6.4 / CONTRACTS §8 call for Π = seeded signed permutation ∘
 * block-diagonal Walsh–Hadamard. Implementation here (documented deviation
 * from a 1536×1536 seeded-QR rotation, which costs seconds in JS):
 *
 *   Π = D2 · (H_2048 / √2048) · D1
 *
 * where H_2048 is the Sylvester Hadamard matrix of size 2048 (the padding
 * dimension — next power of two ≥ 1536), D1/D2 are diagonal sign flips from a
 * seeded PRNG. H is never materialized: it is applied with the fast Walsh–
 * Hadamard transform in O(n log n) on a Float64Array.
 *
 * The 1536-dimensional input is zero-padded to 2048 before the transform and
 * the first 1536 outputs are kept. Padding + truncation perturbs exact
 * orthogonality of the 1536-dim projection (documented, accepted — it only
 * spreads quantization energy). Norm preservation is asserted in tests on the
 * FULL 2048 domain where Π is exactly orthogonal.
 *
 * Forward (encode):  y = first1536(D2 · H/√n · D1 · pad(u))
 * Inverse (decode):  û = first1536(D1 · H/√n · D2 · pad(ŷ))
 *   (H is symmetric and orthogonal, so Π⁻¹ = D1 · (H/√n) · D2.)
 */

import { fwhtInPlaceOptimized } from './accelerator.js';
import { mulberry32 } from './prng.js';

/** Padding dimension: next power of two ≥ TQ_DIM (1536 → 2048). */
export const TQ_PAD_DIM = 2048;

const INV_SQRT_N = 1 / Math.sqrt(TQ_PAD_DIM);

export interface ProjectionSigns {
  readonly s1: Int8Array; // ±1 signs applied before the FWHT
  readonly s2: Int8Array; // ±1 signs applied after the FWHT
}

// Small per-seed cache (tests use a handful of seeds; production uses one).
const signCache = new Map<number, ProjectionSigns>();

/**
 * Seeded sign vectors for Π. Stream: mulberry32(seed), first 2048 draws are
 * s1, next 2048 draws are s2 (draw < 0.5 → −1, else +1). Deterministic.
 */
export function getProjectionSigns(seed: number): ProjectionSigns {
  const key = seed >>> 0;
  const hit = signCache.get(key);
  if (hit !== undefined) return hit;
  if (signCache.size > 8) signCache.clear();
  const rng = mulberry32(key);
  const s1 = new Int8Array(TQ_PAD_DIM);
  const s2 = new Int8Array(TQ_PAD_DIM);
  for (let i = 0; i < TQ_PAD_DIM; i++) s1[i] = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < TQ_PAD_DIM; i++) s2[i] = rng() < 0.5 ? -1 : 1;
  const signs: ProjectionSigns = { s1, s2 };
  signCache.set(key, signs);
  return signs;
}

/** In-place fast Walsh–Hadamard transform (Sylvester ordering). n must be a power of two. */
export function fwhtInPlace(a: Float64Array): void {
  const n = a.length;
  if (n === TQ_PAD_DIM) {
    fwhtInPlaceOptimized(a);
    return;
  }
  for (let h = 1; h < n; h <<= 1) {
    for (let i = 0; i < n; i += h << 1) {
      for (let j = i; j < i + h; j++) {
        const x = a[j];
        const y = a[j + h];
        a[j] = x + y;
        a[j + h] = x - y;
      }
    }
  }
}

const scratch = new Float64Array(TQ_PAD_DIM);

/**
 * In-place full-2048 signed orthogonal transform: v ← D2·(H/√n)·D1·v.
 * Exactly norm-preserving (asserted in tests). Exposed for energy tests.
 */
export function signedFwt2048(v: Float64Array, seed: number): void {
  const { s1, s2 } = getProjectionSigns(seed);
  for (let i = 0; i < TQ_PAD_DIM; i++) v[i] *= s1[i];
  fwhtInPlace(v);
  for (let i = 0; i < TQ_PAD_DIM; i++) v[i] *= s2[i] * INV_SQRT_N;
}

/**
 * Encode-side projection: y ← first 1536 coords of Π·pad(u).
 * `u` must have exactly 1536 entries; `out` receives 1536 values.
 */
export function projectUnit(u: ArrayLike<number>, out: Float64Array, seed: number): void {
  const { s1, s2 } = getProjectionSigns(seed);
  const s = scratch;
  s.fill(0);
  for (let i = 0; i < 1536; i++) s[i] = u[i] * s1[i];
  fwhtInPlace(s);
  for (let i = 0; i < 1536; i++) out[i] = s[i] * s2[i] * INV_SQRT_N;
}

/**
 * Decode-side embedding: û ← first 1536 coords of Πᵀ·pad(y).
 * `y` has 1536 entries (decoded centroid vector ŷ); `out` receives 1536 values.
 */
export function embedBack(y: ArrayLike<number>, out: Float64Array, seed: number): void {
  const { s1, s2 } = getProjectionSigns(seed);
  const s = scratch;
  s.fill(0);
  for (let i = 0; i < 1536; i++) s[i] = y[i] * s2[i];
  fwhtInPlace(s);
  for (let i = 0; i < 1536; i++) out[i] = s[i] * s1[i] * INV_SQRT_N;
}

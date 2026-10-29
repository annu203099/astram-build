/**
 * TurboQuant core: quantizeRecord / decode / unbiased inner-product estimator.
 *
 * Record layout (772 bytes, CONTRACTS §8 — the Handbook's "576 B @ 2.5-bit"
 * is arithmetically 3-bit; 772 B is authoritative):
 *
 *   [0..3]    4 B   two FP16 norms: ||x||₂ then ||r||₂ (little-endian)
 *   [4..579]  576 B 1536 × 3-bit Lloyd–Max scalar codes (N(0,1), 8 levels)
 *   [580..771]192 B 1536 QJL sign bits sign(S·r)
 *
 * Pipeline (for unit u = x/||x||):
 *   y  = first1536(Π·pad(u))                       (signed FWHT, 2048 domain)
 *   v_i = √2048 · y_i ~ N(0,1)                     (per-coord variance matching)
 *   codes_i = lloydMaxIndex(v_i); ŷ_i = centroid_i / √2048
 *   û  = first1536(Πᵀ·pad(ŷ)); r = u − û
 *   z  = sign(S·r)
 *
 * Estimator (both records quantized through the SAME seed / same Π and S):
 *   ⟨x,q⟩ ≈ ||x||·||q||·( ⟨ŷ_x, ŷ_q⟩ + (2·popcount(z_x ∧ z_q)/1536 − 1)·||r_x||·||r_q|| )
 *
 * where ⟨ŷ_x, ŷ_q⟩ is the code-domain dot product Σ CENT[c_x,i]·CENT[c_q,i]/2048.
 * NOTE (documented deviation, see error log): the exact ⟨û_x, û_q⟩ in the
 * original domain would require an inverse FWHT per record in every scan
 * (~0.013 ms × 100k = 1.3 s — kills the 150 ms budget). By Parseval the
 * code-domain dot equals the full-2048-domain dot of the reconstructions;
 * they differ only through the documented 512-dim tail truncation, and the
 * QJL residual term absorbs exactly that difference. Additionally the contract
 * formula multiplies only the first term by ||x||·||q|| — that is correct for
 * unit vectors; for general norms we scale BOTH terms (the residual is defined
 * on the unit sphere, so its correlation contribution must carry the same
 * norm product). With unit vectors the formula reduces to the contract's
 * exact form.
 */

import { decodeFp16, encodeFp16 } from './fp16.js';
import { pack3BitCodes, popcountDiffU32, unpack3BitCodes } from './bitpack.js';
import { decodeIndex, getLloydMax8, quantizeScalarIndex } from './lloydmax.js';
import { embedBack, projectUnit, TQ_PAD_DIM } from './orthogonal.js';
import { computeQjlSigns } from './qjl.js';

/** Behavioral vector dimension (Handbook §6.4: 1536-dim flight recorder). */
export const TQ_DIM = 1536;
/** Packed record size: 4 B norms + 576 B scalar codes + 192 B QJL signs. */
export const TQ_RECORD_BYTES = 772;
/** Default deterministic seed (same seed → same Π and same S, every time). */
export const TQ_DEFAULT_SEED = 0xc0ffee;

export const TQ_OFFSET_NORMS = 0;
export const TQ_OFFSET_CODES = 4;
export const TQ_OFFSET_SIGNS = 580;

const SCALE = Math.sqrt(TQ_PAD_DIM); // per-coord variance matching for N(0,1)
const INV_SCALE = 1 / SCALE;
const INV_PAD_DIM = 1 / TQ_PAD_DIM;

export interface TqNorms {
  xL2: number;
  rL2: number;
}

export interface TqQuantizedRecord {
  readonly record: Uint8Array;
  readonly norms: TqNorms;
  decodeUnit(): Float32Array;
}

// Module-level scratch (single-threaded use; all public outputs are copies).
const uScratch = new Float64Array(TQ_DIM);
const yScratch = new Float64Array(TQ_DIM);
const uhScratch = new Float64Array(TQ_DIM);
const rScratch = new Float64Array(TQ_DIM);
const codesScratch = new Uint8Array(TQ_DIM);
const codesScratch2 = new Uint8Array(TQ_DIM);
const signBufA = new Uint8Array(192);
const signBufB = new Uint8Array(192);
const u32ViewA = new Uint32Array(signBufA.buffer, 0, 48);
const u32ViewB = new Uint32Array(signBufB.buffer, 0, 48);

let prodLut: Float64Array | null = null;

/** 64-entry LUT: PROD[a*8+b] = centroid[a] · centroid[b]. */
function getProdLut(): Float64Array {
  if (prodLut === null) {
    const c = getLloydMax8().centroids;
    const t = new Float64Array(64);
    for (let a = 0; a < 8; a++) {
      for (let b = 0; b < 8; b++) t[a * 8 + b] = c[a] * c[b];
    }
    prodLut = t;
  }
  return prodLut;
}

/**
 * Quantize a 1536-dim behavioral vector into the 772-byte TurboQuant record.
 * Zero vector → u = e_0 (||x|| = 0). Throws RangeError on wrong length.
 */
export function quantizeRecord(x: Float32Array | number[], seed: number = TQ_DEFAULT_SEED): TqQuantizedRecord {
  if (x.length !== TQ_DIM) {
    throw new RangeError(`quantizeRecord: input must have exactly ${TQ_DIM} elements, got ${x.length}`);
  }
  let sum = 0;
  for (let i = 0; i < TQ_DIM; i++) {
    const v = x[i];
    sum += v * v;
  }
  const xL2 = Math.sqrt(sum);
  if (xL2 > 0) {
    for (let i = 0; i < TQ_DIM; i++) uScratch[i] = x[i] / xL2;
  } else {
    uScratch.fill(0);
    uScratch[0] = 1; // zero vector → canonical basis vector e_0
  }

  projectUnit(uScratch, yScratch, seed);
  for (let i = 0; i < TQ_DIM; i++) codesScratch[i] = quantizeScalarIndex(yScratch[i] * SCALE);
  for (let i = 0; i < TQ_DIM; i++) yScratch[i] = decodeIndex(codesScratch[i]) * INV_SCALE; // ŷ
  embedBack(yScratch, uhScratch, seed); // û = Πᵀ·pad(ŷ), first 1536

  let rsum = 0;
  for (let i = 0; i < TQ_DIM; i++) {
    const d = uScratch[i] - uhScratch[i];
    rScratch[i] = d;
    rsum += d * d;
  }
  const rL2 = Math.sqrt(rsum);

  const record = new Uint8Array(TQ_RECORD_BYTES);
  const hx = encodeFp16(xL2);
  const hr = encodeFp16(rL2);
  record[0] = hx & 0xff;
  record[1] = hx >>> 8;
  record[2] = hr & 0xff;
  record[3] = hr >>> 8;
  pack3BitCodes(codesScratch, record.subarray(TQ_OFFSET_CODES, TQ_OFFSET_CODES + 576));
  computeQjlSigns(rScratch, seed, signBufA);
  record.set(signBufA, TQ_OFFSET_SIGNS);

  return {
    record,
    norms: { xL2, rL2 },
    decodeUnit: () => decodeUnitVector(record, seed),
  };
}

/** Decode the two FP16 norms from a record. */
export function decodeNorms(record: Uint8Array): TqNorms {
  return {
    xL2: decodeFp16(record[0] | (record[1] << 8)),
    rL2: decodeFp16(record[2] | (record[3] << 8)),
  };
}

/**
 * Decode the approximate unit direction û ≈ u from a record's scalar codes
 * (inverse signed FWHT of the decoded centroids). This is the exact decoder
 * side of the encoder; the scan estimator uses the cheaper code-domain dot
 * (see module comment). `seed` must match the seed the record was written with.
 */
export function decodeUnitVector(record: Uint8Array, seed: number = TQ_DEFAULT_SEED): Float32Array {
  if (record.length !== TQ_RECORD_BYTES) {
    throw new RangeError(`decodeUnitVector: record must be ${TQ_RECORD_BYTES} bytes, got ${record.length}`);
  }
  unpack3BitCodes(record, TQ_OFFSET_CODES, codesScratch);
  for (let i = 0; i < TQ_DIM; i++) yScratch[i] = decodeIndex(codesScratch[i]) * INV_SCALE;
  embedBack(yScratch, uhScratch, seed);
  const out = new Float32Array(TQ_DIM);
  for (let i = 0; i < TQ_DIM; i++) out[i] = uhScratch[i];
  return out;
}

/**
 * Unbiased inner-product estimator between two quantized records (CONTRACTS §8).
 * Both records must come from the same seed (same Π, same S).
 */
export function estimateInnerProductRecords(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== TQ_RECORD_BYTES || b.length !== TQ_RECORD_BYTES) {
    throw new RangeError(`estimateInnerProductRecords: records must be ${TQ_RECORD_BYTES} bytes`);
  }
  const na = decodeNorms(a);
  const nb = decodeNorms(b);
  unpack3BitCodes(a, TQ_OFFSET_CODES, codesScratch);
  unpack3BitCodes(b, TQ_OFFSET_CODES, codesScratch2);
  const lut = getProdLut();
  let dot = 0;
  for (let i = 0; i < TQ_DIM; i++) {
    dot += lut[(codesScratch[i] << 3) | codesScratch2[i]];
  }
  signBufA.set(a.subarray(TQ_OFFSET_SIGNS, TQ_OFFSET_SIGNS + 192));
  signBufB.set(b.subarray(TQ_OFFSET_SIGNS, TQ_OFFSET_SIGNS + 192));
  const pop = popcountDiffU32(u32ViewA, u32ViewB, 48); // sign DISAGREEMENTS
  const agreement = TQ_DIM - pop;
  const coef = (2 * agreement) / TQ_DIM - 1;
  return na.xL2 * nb.xL2 * (dot * INV_PAD_DIM + coef * na.rL2 * nb.rL2);
}

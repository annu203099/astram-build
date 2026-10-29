import { describe, expect, it } from 'vitest';
import {
  decodeFp16,
  decodeIndex,
  decodeNorms,
  decodeUnitVector,
  encodeFp16,
  estimateInnerProductRecords,
  getLloydMax8,
  quantizeRecord,
  quantizeScalarIndex,
  signedFwt2048,
  TQ_DIM,
  TQ_PAD_DIM,
  TQ_RECORD_BYTES,
} from './index.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomVector(seed: number, norm = 1): Float32Array {
  const rnd = mulberry32(seed);
  const v = new Float32Array(TQ_DIM);
  let s = 0;
  for (let i = 0; i < TQ_DIM; i++) {
    v[i] = rnd() * 2 - 1;
    s += v[i] * v[i];
  }
  const scale = norm / Math.sqrt(s);
  for (let i = 0; i < TQ_DIM; i++) v[i] *= scale;
  return v;
}

describe('Lloyd–Max 8-level quantizer for N(0,1)', () => {
  const { centroids, thresholds } = getLloydMax8();

  it('has 8 ascending, symmetric centroids and a central 0 threshold', () => {
    for (let k = 0; k < 7; k++) expect(centroids[k]).toBeLessThan(centroids[k + 1]);
    for (let k = 0; k < 8; k++) {
      expect(Math.abs(centroids[k] + centroids[7 - k])).toBeLessThan(1e-9);
    }
    expect(Math.abs(thresholds[3])).toBeLessThan(1e-9);
    // Known optimum ±2.1520, ±1.3439, ±0.7560, ±0.2451 (loose).
    expect(Math.abs(centroids[7] - 2.152)).toBeLessThan(0.02);
    expect(Math.abs(centroids[6] - 1.344)).toBeLessThan(0.02);
    expect(Math.abs(centroids[5] - 0.756)).toBeLessThan(0.02);
    expect(Math.abs(centroids[4] - 0.2451)).toBeLessThan(0.02);
  });

  it('quantize/decode round-trips each level to its centroid', () => {
    for (let k = 0; k < 8; k++) {
      expect(decodeIndex(quantizeScalarIndex(decodeIndex(k)))).toBeCloseTo(decodeIndex(k), 12);
    }
  });

  it('achieves the textbook-optimal MSE on N(0,1) (optimal 8-level ≈ 0.03454)', () => {
    const rnd = mulberry32(42);
    let mse = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      // Box–Muller
      const u1 = Math.max(rnd(), 1e-12);
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rnd());
      const d = g - decodeIndex(quantizeScalarIndex(g));
      mse += d * d;
    }
    mse /= n;
    expect(mse).toBeGreaterThan(0.03);
    expect(mse).toBeLessThan(0.04);
  });
});

describe('FP16 norms', () => {
  it('round-trips normals within 0.1% relative error', () => {
    for (const v of [1, 0.5, 0.25, 0.1, 0.05, 0.001, 3.14159, 123.456, 2048, 65504]) {
      const back = decodeFp16(encodeFp16(v));
      expect(Math.abs(back - v) / v).toBeLessThan(0.001);
      const neg = decodeFp16(encodeFp16(-v));
      expect(Math.abs(Math.abs(neg) - v) / v).toBeLessThan(0.001);
    }
  });
});

describe('signed Walsh–Hadamard Π (orthogonality)', () => {
  it('exactly preserves norms on the full 2048 domain', () => {
    const rnd = mulberry32(7);
    const v = new Float64Array(TQ_PAD_DIM);
    let s = 0;
    for (let i = 0; i < TQ_PAD_DIM; i++) {
      v[i] = rnd() * 2 - 1;
      s += v[i] * v[i];
    }
    const n0 = Math.sqrt(s);
    signedFwt2048(v, 0xc0ffee);
    let s2 = 0;
    for (let i = 0; i < TQ_PAD_DIM; i++) s2 += v[i] * v[i];
    expect(Math.abs(Math.sqrt(s2) - n0) / n0).toBeLessThan(1e-9);
    signedFwt2048(v, 0xc0ffee); // inverse (self-inverse with same signs? Π² ≠ I, but ΠᵀΠ = I)
    let s3 = 0;
    for (let i = 0; i < TQ_PAD_DIM; i++) s3 += v[i] * v[i];
    expect(Math.abs(Math.sqrt(s3) - n0) / n0).toBeLessThan(1e-9);
  });
});

describe('quantizeRecord (772-byte layout)', () => {
  it('produces exactly 772 bytes with decodable norms and packed signs', () => {
    const x = randomVector(1, 39.2);
    const q = quantizeRecord(x);
    expect(q.record).toBeInstanceOf(Uint8Array);
    expect(q.record.length).toBe(TQ_RECORD_BYTES);
    expect(q.norms.xL2).toBeCloseTo(39.2, 1);
    expect(q.norms.rL2).toBeGreaterThan(0.2);
    expect(q.norms.rL2).toBeLessThan(0.8);
    const norms = decodeNorms(q.record);
    expect(Math.abs(norms.xL2 - q.norms.xL2) / q.norms.xL2).toBeLessThan(0.001);
    expect(Math.abs(norms.rL2 - q.norms.rL2) / q.norms.rL2).toBeLessThan(0.001);
    // Sign block must be binary.
    for (let i = 580; i < 772; i++) {
      // nothing to assert per byte (bits) — spot-check byte range sanity via unpack below
    }
    const u = q.decodeUnit();
    expect(u.length).toBe(TQ_DIM);
    let un = 0;
    for (let i = 0; i < TQ_DIM; i++) un += u[i] * u[i];
    const norm = Math.sqrt(un);
    expect(norm).toBeGreaterThan(0.6);
    expect(norm).toBeLessThan(0.95);
  });

  it('throws on wrong dimension', () => {
    expect(() => quantizeRecord(new Float32Array(15))).toThrow(RangeError);
  });

  it('is deterministic per seed and seed-sensitive', () => {
    const x = randomVector(2, 10);
    const a = quantizeRecord(x, 0xc0ffee).record;
    const b = quantizeRecord(x, 0xc0ffee).record;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const c = quantizeRecord(x, 1234).record;
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
    let signDiffBits = 0;
    for (let i = 580; i < 772; i++) {
      let m = a[i] ^ c[i];
      while (m) {
        m &= m - 1;
        signDiffBits++;
      }
    }
    expect(signDiffBits).toBeGreaterThan(400); // near-half of 1536
  });

  it('handles the zero vector via the e_0 convention', () => {
    const q = quantizeRecord(new Float32Array(TQ_DIM));
    expect(q.norms.xL2).toBe(0);
    const u = q.decodeUnit();
    expect(u[0]).not.toBe(0);
  });
});

describe('unbiased inner-product estimator', () => {
  it('estimates ⟨x,q⟩ within 0.12·||x||·||q|| for 200 random pairs', () => {
    let worst = 0;
    for (let t = 0; t < 200; t++) {
      const x = randomVector(1000 + t * 2, 5 + (t % 7));
      const y = randomVector(1001 + t * 2, 3 + (t % 5));
      let trueDot = 0;
      for (let i = 0; i < TQ_DIM; i++) trueDot += x[i] * y[i];
      const est = estimateInnerProductRecords(quantizeRecord(x).record, quantizeRecord(y).record);
      let nx = 0;
      let ny = 0;
      for (let i = 0; i < TQ_DIM; i++) {
        nx += x[i] * x[i];
        ny += y[i] * y[i];
      }
      const tol = 0.12 * Math.sqrt(nx) * Math.sqrt(ny);
      worst = Math.max(worst, Math.abs(est - trueDot) / tol);
      if (Math.abs(est - trueDot) > tol) {
        throw new Error(
          `pair ${t}: est=${est.toFixed(4)} true=${trueDot.toFixed(4)} tol=${tol.toFixed(4)}`
        );
      }
    }
    // Report margin (worst ratio should be well under 1.0).
    expect(worst).toBeLessThan(1.0);
  });

  it('ranks a near-identical pair above an orthogonal pair', () => {
    const x = randomVector(31, 12);
    const twin = randomVector(31, 12);
    for (let i = 0; i < TQ_DIM; i++) twin[i] += (i % 3) * 1e-3 * 12; // small perturbation
    const other = randomVector(32, 12);
    const selfEst = estimateInnerProductRecords(quantizeRecord(x).record, quantizeRecord(twin).record);
    const otherEst = estimateInnerProductRecords(quantizeRecord(x).record, quantizeRecord(other).record);
    expect(selfEst).toBeGreaterThan(otherEst * 3 + 1);
  });

  it('is unbiased for independent pairs (mean ≈ true ≈ 0, no systematic −0.5·||r||² offset)', () => {
    // Regression test for the popcount(AND) → popcount(XOR) fix.
    const ests: number[] = [];
    const trues: number[] = [];
    for (let t = 0; t < 60; t++) {
      const x = randomVector(5000 + t * 2, 1);
      const y = randomVector(5001 + t * 2, 1);
      let trueDot = 0;
      for (let i = 0; i < TQ_DIM; i++) trueDot += x[i] * y[i];
      ests.push(estimateInnerProductRecords(quantizeRecord(x).record, quantizeRecord(y).record));
      trues.push(trueDot);
    }
    const meanErr = ests.reduce((s, e, i) => s + (e - trues[i]), 0) / ests.length;
    expect(Math.abs(meanErr)).toBeLessThan(0.02);
  });
});

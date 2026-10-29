/**
 * IEEE 754 binary16 (half precision) encoder/decoder — pure integer math via a
 * Float32Array/Uint32Array bit view (no DataView allocation in the hot path).
 *
 * Used to store ||x||₂ and ||r||₂ in 2 bytes each inside the 4-byte norm block
 * of every 772-byte TurboQuant record. Round-trip relative error for normal
 * values is ≤ 2^-11 ≈ 0.0488% (half precision has an 11-bit significand),
 * comfortably inside the 0.1% acceptance bound.
 */

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

/**
 * Encode a JS number to its 16-bit half-precision representation (returned as
 * an unsigned 16-bit integer pattern). Round-to-nearest-even; overflow rounds
 * to ±Infinity; |v| below half the smallest subnormal rounds to signed zero.
 */
export function encodeFp16(value: number): number {
  f32Scratch[0] = value; // round to single precision first (half of the work)
  const x = u32Scratch[0];
  const sign = (x >>> 16) & 0x8000;
  const e32 = (x >>> 23) & 0xff;
  const m32 = x & 0x7fffff;
  if (e32 === 0xff) {
    // Inf / NaN in float32
    return sign | (m32 !== 0 ? 0x7e00 : 0x7c00);
  }
  const e16 = e32 - 127 + 15;
  if (e16 >= 0x1f) {
    return sign | 0x7c00; // overflow → ±Inf
  }
  if (e16 <= 0) {
    // fp16 subnormal (value < 2^-14)
    if (e16 < -10) return sign; // strictly below half of the min subnormal → signed 0
    const m = m32 | 0x800000; // make the implicit float32 bit explicit
    const shift = 14 - e16; // 14 .. 24
    let m16 = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && (m16 & 1) === 1)) m16++;
    if (m16 >= 0x400) return sign | 0x0400; // carried into the smallest normal 2^-14
    return sign | m16;
  }
  let h = (e16 << 10) | (m32 >>> 13);
  const rem = m32 & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1) === 1)) {
    h++;
    if (h > 0x7bff) return sign | 0x7c00; // mantissa carried into Infinity
  }
  return sign | h;
}

/** Decode a 16-bit half-precision pattern (unsigned int) back to a JS number. */
export function decodeFp16(h: number): number {
  const sign = (h & 0x8000) !== 0 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return sign * m * 5.9604644775390625e-8; // m × 2^-24
  if (e === 0x1f) return m !== 0 ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * (1 + m / 1024) * Math.pow(2, e - 15);
}

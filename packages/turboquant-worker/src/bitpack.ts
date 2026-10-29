/**
 * Bit packing for the TurboQuant record payload.
 *
 * 3-bit scalar codes: 1536 Lloyd–Max indices × 3 bits = 4608 bits = 576 bytes.
 * Bit order is little-endian (LSB-first): code j occupies stream bits
 * [3j, 3j+3), stream bit i lives in byte i >> 3 at bit position i & 7.
 *
 * Sign bits: 1536 QJL signs × 1 bit = 192 bytes, same LSB-first order.
 *
 * Popcount uses a 256-entry byte lookup table — the documented pure-JS
 * substitute for a hardware POPCNT instruction (CONTRACTS §8 / Handbook §11).
 */

/** Pack `codes` (values 0..7, length 1536) into `out` (length 576). */
export function pack3BitCodes(codes: Uint8Array, out: Uint8Array): void {
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < codes.length; i++) {
    acc |= (codes[i] & 7) << bits;
    bits += 3;
    while (bits >= 8) {
      out[pos++] = acc & 0xff;
      acc >>>= 8;
      bits -= 8;
    }
  }
  if (bits > 0) out[pos] = acc & 0xff;
}

/** Unpack 1536 3-bit codes from `src[srcOffset..srcOffset+576)` into `out`. */
export function unpack3BitCodes(src: Uint8Array, srcOffset: number, out: Uint8Array): void {
  let acc = 0;
  let bits = 0;
  let pos = srcOffset;
  for (let i = 0; i < out.length; i++) {
    while (bits < 3) {
      acc |= src[pos++] << bits;
      bits += 8;
    }
    out[i] = acc & 7;
    acc >>>= 3;
    bits -= 3;
  }
}

/** Pack 1536 sign bits (0/1 in `signs`) into 192 bytes in `out`. */
export function packSignBits(signs: Uint8Array, out: Uint8Array): void {
  out.fill(0);
  for (let i = 0; i < signs.length; i++) {
    if (signs[i] !== 0) out[i >> 3] |= 1 << (i & 7);
  }
}

/** Unpack 192 bytes into 1536 sign bits (0/1) in `out`. */
export function unpackSignBits(src: Uint8Array, srcOffset: number, out: Uint8Array): void {
  for (let i = 0; i < out.length; i++) {
    out[i] = (src[srcOffset + (i >> 3)] >>> (i & 7)) & 1;
  }
}

/** 256-entry byte popcount table (hardware-POPCNT substitute). */
export const POPCOUNT_U8: Uint8Array = (() => {
  const t = new Uint8Array(256);
  for (let i = 1; i < 256; i++) t[i] = t[i >> 1] + (i & 1);
  return t;
})();

/**
 * popcount(A XOR B) over `words` 32-bit words — the number of positions where
 * the two sign vectors DISAGREE. Views must be Uint32Array views over aligned
 * buffers. No BigInt, no Math.clz32 tricks — just the byte table.
 *
 * NOTE (fix, see docs/error-log/turboquant-worker.md): the agreement term of
 * the QJL estimator needs sign AGREEMENT = 1536 − popcount(A XOR B). The
 * contract's literal "popcount(z_x ∧ z_q)" (plain AND) is biased: for
 * independent signs E[AND] = d/4, which would offset every score by ≈ −0.5·
 * ||r_x||·||r_q|| instead of the required unbiased ≈ 0.
 */
export function popcountDiffU32(a: Uint32Array, b: Uint32Array, words: number): number {
  const t = POPCOUNT_U8;
  let pop = 0;
  for (let i = 0; i < words; i++) {
    const m = a[i] ^ b[i];
    pop += t[m & 0xff] + t[(m >>> 8) & 0xff] + t[(m >>> 16) & 0xff] + t[(m >>> 24) & 0xff];
  }
  return pop;
}

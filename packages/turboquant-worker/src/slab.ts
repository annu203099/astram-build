/**
 * TurboQuantSlab — append-only binary slab file of 772-byte quantized records.
 *
 * File layout:
 *   [0..3]    magic ASCII 'TQSL'
 *   [4..5]    u16 version = 1            (little-endian)
 *   [6..7]    u16 dim = 1536
 *   [8..9]    u16 recordSize = 772
 *   [10..11]  u16 reserved = 0
 *   [12..19]  u64 recordCount (LE, two u32 words — no BigInt anywhere)
 *   [20..51]  32 B seed/flags: u32 seed at 20, u32 flags at 24 (0), rest zero
 *   [52..63]  zero padding
 *   [64..]    records, 772 B each
 *
 * Design notes (documented choices):
 * - Open-per-op fs strategy: each append/query opens the file, does positioned
 *   writes/reads, and closes. No long-lived fd to leak; close() is therefore a
 *   soft "mark closed" no-op-ish call. Single-writer assumption (the server
 *   process owns its slab).
 * - append writes the record first, then bumps the header count in place
 *   (offset 12). fsync is OFF by default (opt-in flag) per spec.
 * - The QUERY is quantized through the same pipeline as stored records
 *   (quantizeRecord(query, slabSeed)) before applying the estimator. This
 *   keeps the estimator symmetric and index-free: both sides suffer the same
 *   quantization noise and both sides' residuals are captured by their QJL
 *   signs, which is what the (2·popcount/d − 1) agreement term needs.
 * - scanTopK reads the whole file ONCE into a buffer, then runs the fused
 *   code-domain dot + popcount inner loop per record (see quantize.ts for why
 *   the code-domain dot is used instead of per-record inverse FWHTs).
 */

import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { POPCOUNT_U16 } from './accelerator.js';
import { POPCOUNT_U8, unpack3BitCodes } from './bitpack.js';
import { decodeFp16 } from './fp16.js';
import { getLloydMax8 } from './lloydmax.js';
import {
  decodeNorms,
  estimateInnerProductRecords,
  quantizeRecord,
  TQ_DIM,
  TQ_OFFSET_CODES,
  TQ_OFFSET_SIGNS,
  TQ_RECORD_BYTES,
  TQ_DEFAULT_SEED,
} from './quantize.js';

export const TQ_HEADER_BYTES = 64;
export const TQ_MAGIC = 'TQSL';
export const TQ_VERSION = 1;
export const TQ_CODES_BYTES = 576;
export const TQ_SIGNS_BYTES = 192;
const U32_PER_RECORD_SIGNS = TQ_SIGNS_BYTES / 4; // 48
const INV_PAD_DIM = 1 / 2048;
const INV_DIM = 1 / TQ_DIM;

export interface TqAppendResult {
  index: number;
  bytesWritten: number;
  elapsedMs: number;
}

export interface TqMatch {
  /** Estimated inner product (unbiased). */
  index: number;
  score: number;
}

export interface TqScanResult {
  matches: TqMatch[];
  elapsedMs: number;
  scanned: number;
}

export interface TurboQuantSlabOptions {
  seed?: number;
  /** Opt-in fsync after each append (off by default per spec). */
  fsync?: boolean;
}

/** Fixed-size binary min-heap for the top-k scan. */
class TopKHeap {
  private readonly cap: number;
  private readonly scores: Float64Array;
  private readonly idx: Int32Array;
  private size = 0;

  constructor(cap: number) {
    this.cap = cap;
    this.scores = new Float64Array(cap);
    this.idx = new Int32Array(cap);
  }

  /** Current worst score kept (−Infinity while filling). */
  worst(): number {
    return this.size < this.cap ? Number.NEGATIVE_INFINITY : this.scores[0];
  }

  push(score: number, index: number): void {
    if (this.size < this.cap) {
      let i = this.size++;
      this.scores[i] = score;
      this.idx[i] = index;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.scores[p] <= this.scores[i]) break;
        this.swap(p, i);
        i = p;
      }
    } else {
      this.scores[0] = score;
      this.idx[0] = index;
      this.siftDown(0);
    }
  }

  /** Matches sorted by score descending. */
  toMatches(): TqMatch[] {
    const out: TqMatch[] = [];
    for (let i = 0; i < this.size; i++) out.push({ index: this.idx[i], score: this.scores[i] });
    out.sort((m, n) => n.score - m.score);
    return out;
  }

  private siftDown(start: number): void {
    let i = start;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.size && this.scores[l] < this.scores[m]) m = l;
      if (r < this.size && this.scores[r] < this.scores[m]) m = r;
      if (m === i) break;
      this.swap(m, i);
      i = m;
    }
  }

  private swap(a: number, b: number): void {
    const s = this.scores[a];
    this.scores[a] = this.scores[b];
    this.scores[b] = s;
    const x = this.idx[a];
    this.idx[a] = this.idx[b];
    this.idx[b] = x;
  }
}

export class TurboQuantSlab {
  readonly slabPath: string;
  private seedValue: number;
  private countCached = -1; // -1 = unknown
  private initialized = false;
  private closed = false;
  private readonly doFsync: boolean;

  constructor(slabPath: string, opts?: TurboQuantSlabOptions) {
    this.slabPath = slabPath;
    this.doFsync = opts?.fsync === true;
    let seed = (opts?.seed ?? TQ_DEFAULT_SEED) >>> 0;
    try {
      const st = fs.statSync(slabPath);
      if (st.size > 0) {
        const hdr = this.readHeader();
        // Stored seed wins: existing records must decode under their own seed.
        seed = hdr.seed;
        this.countCached = hdr.count;
        this.initialized = true;
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw err;
      // no file yet → created lazily on first append with the requested seed
    }
    this.seedValue = seed;
  }

  /** Seed used for quantization (constructor seed at creation, header seed thereafter). */
  get seed(): number {
    return this.seedValue;
  }

  /**
   * Quantize `x` (length must be 1536) and append one 772-byte record.
   * Returns the record index, bytes written (always 772) and elapsed ms.
   */
  append(x: Float32Array | number[]): TqAppendResult {
    this.assertOpen();
    const t0 = performance.now();
    const index = this.ensureFile();
    const q = quantizeRecord(x, this.seedValue);
    const fd = fs.openSync(this.slabPath, 'r+');
    try {
      fs.writeSync(fd, q.record, 0, TQ_RECORD_BYTES, TQ_HEADER_BYTES + index * TQ_RECORD_BYTES);
      const cnt = Buffer.allocUnsafe(8);
      cnt.writeUInt32LE((index + 1) >>> 0, 0);
      cnt.writeUInt32LE(Math.floor((index + 1) / 0x100000000), 4);
      fs.writeSync(fd, cnt, 0, 8, 12);
      if (this.doFsync) fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this.countCached = index + 1;
    return { index, bytesWritten: TQ_RECORD_BYTES, elapsedMs: performance.now() - t0 };
  }

  /** Number of records: fresh header read, cross-checked against the file size. */
  count(): number {
    this.assertOpen();
    if (!fs.existsSync(this.slabPath)) return 0;
    const st = fs.statSync(this.slabPath);
    if (st.size < TQ_HEADER_BYTES) {
      throw new Error(`TurboQuantSlab: slab file smaller than header (${st.size} B) — corrupt: ${this.slabPath}`);
    }
    const rem = st.size - TQ_HEADER_BYTES;
    if (rem % TQ_RECORD_BYTES !== 0) {
      throw new Error(`TurboQuantSlab: trailing partial record (${rem % TQ_RECORD_BYTES} B) — corrupt: ${this.slabPath}`);
    }
    const statCount = rem / TQ_RECORD_BYTES;
    const hdr = this.readHeader();
    if (hdr.count > statCount) {
      throw new Error(`TurboQuantSlab: header count ${hdr.count} exceeds records present (${statCount}) — truncated: ${this.slabPath}`);
    }
    // hdr.count < statCount can only happen after a crash between the record
    // write and the count bump; report the committed header count.
    this.countCached = hdr.count;
    return hdr.count;
  }

  /**
   * Estimated ⟨query, x_index⟩. The query is quantized through the same
   * pipeline (same seed) so the estimator stays symmetric and unbiased.
   */
  approxInnerProduct(query: Float32Array | number[], index: number): number {
    this.assertOpen();
    const total = this.count();
    if (!Number.isInteger(index) || index < 0 || index >= total) {
      throw new RangeError(`TurboQuantSlab.approxInnerProduct: index ${index} out of range [0, ${total})`);
    }
    const rec = Buffer.allocUnsafe(TQ_RECORD_BYTES);
    this.readRecordAt(index, rec);
    const q = quantizeRecord(query, this.seed);
    return estimateInnerProductRecords(q.record, rec);
  }

  /**
   * Scan every record and return the k highest estimated inner products.
   * The whole file is read once; per-record work is the fused code-domain
   * dot + 48-word popcount (see module docs). `scanned` is the record count.
   */
  scanTopK(query: Float32Array | number[], k: number): TqScanResult {
    this.assertOpen();
    const t0 = performance.now();
    const total = this.count();
    if (k <= 0 || total === 0) {
      return { matches: [], elapsedMs: performance.now() - t0, scanned: total };
    }

    const fileBuf = fs.readFileSync(this.slabPath);
    // Aligned byte + u32 views over the record area (readFileSync buffers are
    // not pooled in Node, but stay defensive about byteOffset).
    let data: Uint8Array;
    let data32: Uint32Array;
    if (fileBuf.byteOffset % 4 === 0 && fileBuf.length % 4 === 0) {
      data = fileBuf;
      data32 = new Uint32Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.length >> 2);
    } else {
      data = new Uint8Array(fileBuf.length);
      data.set(fileBuf);
      data32 = new Uint32Array(data.buffer, 0, data.length >> 2);
    }

    // Query side: quantize through the same pipeline, precompute weights/signs.
    const q = quantizeRecord(query, this.seed);
    const qcodes = new Uint8Array(TQ_DIM);
    unpack3BitCodes(q.record, TQ_OFFSET_CODES, qcodes);
    const cent = getLloydMax8().centroids;
    const w = new Float64Array(TQ_DIM);
    for (let i = 0; i < TQ_DIM; i++) w[i] = cent[qcodes[i]];
    const qn = decodeNorms(q.record);
    const qSigns = new Uint8Array(TQ_SIGNS_BYTES);
    qSigns.set(q.record.subarray(TQ_OFFSET_SIGNS, TQ_OFFSET_SIGNS + TQ_SIGNS_BYTES));
    const q32 = new Uint32Array(qSigns.buffer, 0, U32_PER_RECORD_SIGNS);

    const pop16 = POPCOUNT_U16;
    const heap = new TopKHeap(Math.min(k, total));
    const qx = qn.xL2;
    const qr = qn.rL2;

    for (let n = 0; n < total; n++) {
      const off = TQ_HEADER_BYTES + n * TQ_RECORD_BYTES;
      const xL2 = decodeFp16(data[off] | (data[off + 1] << 8));
      const rL2 = decodeFp16(data[off + 2] | (data[off + 3] << 8));
      let dot = 0;
      let p = off + TQ_OFFSET_CODES;
      let qi = 0;
      // 192 groups of 3 bytes → 8 codes each (576 B = 1536 × 3-bit).
      for (let g = 0; g < 192; g++) {
        const v = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16);
        p += 3;
        dot +=
          cent[v & 7] * w[qi] +
          cent[(v >>> 3) & 7] * w[qi + 1] +
          cent[(v >>> 6) & 7] * w[qi + 2] +
          cent[(v >>> 9) & 7] * w[qi + 3] +
          cent[(v >>> 12) & 7] * w[qi + 4] +
          cent[(v >>> 15) & 7] * w[qi + 5] +
          cent[(v >>> 18) & 7] * w[qi + 6] +
          cent[(v >>> 21) & 7] * w[qi + 7];
        qi += 8;
      }
      let pc = 0;
      const s32 = (off + TQ_OFFSET_SIGNS) >> 2; // 580 ≡ 0 (mod 4), header/record sizes ≡ 0
      for (let j = 0; j < U32_PER_RECORD_SIGNS; j++) {
        const m = data32[s32 + j] ^ q32[j]; // sign DISAGREEMENTS → agreement = dim − pc
        pc += pop16[m & 0xffff] + pop16[(m >>> 16) & 0xffff];
      }
      const agreement = TQ_DIM - pc;
      const score = qx * xL2 * (dot * INV_PAD_DIM + ((2 * agreement) / TQ_DIM - 1) * qr * rL2);
      if (Number.isNaN(score)) continue;
      if (score > heap.worst()) heap.push(score, n);
    }

    return { matches: heap.toMatches(), elapsedMs: performance.now() - t0, scanned: total };
  }

  /**
   * Mark the slab closed. Open-per-op means there is no fd to release; this
   * is the documented no-op-ish close — further operations throw.
   */
  close(): void {
    this.closed = true;
  }

  // ---- internals ----------------------------------------------------------

  private assertOpen(): void {
    if (this.closed) throw new Error(`TurboQuantSlab: slab is closed (${this.slabPath})`);
  }

  private ensureFile(): number {
    if (this.countCached < 0) this.countCached = 0;
    if (!this.initialized) {
      const hdr = Buffer.alloc(TQ_HEADER_BYTES);
      writeHeader(hdr, this.seedValue, this.countCached);
      let fd: number;
      try {
        fd = fs.openSync(this.slabPath, 'wx');
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'EEXIST') throw err;
        // Pre-existing but empty file (size 0 skipped in the ctor): refresh its header.
        fd = fs.openSync(this.slabPath, 'r+');
      }
      try {
        fs.writeSync(fd, hdr, 0, TQ_HEADER_BYTES, 0);
      } finally {
        fs.closeSync(fd);
      }
      this.initialized = true;
    }
    return this.countCached;
  }

  private readHeader(): { count: number; seed: number; version: number; dim: number; recordSize: number } {
    const fd = fs.openSync(this.slabPath, 'r');
    try {
      const hdr = Buffer.alloc(TQ_HEADER_BYTES);
      let got = 0;
      while (got < TQ_HEADER_BYTES) {
        const n = fs.readSync(fd, hdr, got, TQ_HEADER_BYTES - got, got);
        if (n <= 0) break;
        got += n;
      }
      if (got < TQ_HEADER_BYTES) {
        throw new Error(`TurboQuantSlab: could not read ${TQ_HEADER_BYTES}-byte header (got ${got} B): ${this.slabPath}`);
      }
      const magic = hdr.toString('ascii', 0, 4);
      if (magic !== TQ_MAGIC) {
        throw new Error(`TurboQuantSlab: bad magic ${JSON.stringify(magic)} (expected '${TQ_MAGIC}'): ${this.slabPath}`);
      }
      const version = hdr.readUInt16LE(4);
      if (version !== TQ_VERSION) {
        throw new Error(`TurboQuantSlab: unsupported slab version ${version} (expected ${TQ_VERSION}): ${this.slabPath}`);
      }
      const dim = hdr.readUInt16LE(6);
      if (dim !== TQ_DIM) {
        throw new Error(`TurboQuantSlab: dim mismatch ${dim} (expected ${TQ_DIM}): ${this.slabPath}`);
      }
      const recordSize = hdr.readUInt16LE(8);
      if (recordSize !== TQ_RECORD_BYTES) {
        throw new Error(`TurboQuantSlab: recordSize mismatch ${recordSize} (expected ${TQ_RECORD_BYTES}): ${this.slabPath}`);
      }
      // u64 count from two u32 words (no BigInt).
      const count = hdr.readUInt32LE(12) + hdr.readUInt32LE(16) * 0x100000000;
      const seed = hdr.readUInt32LE(20);
      return { count, seed, version, dim, recordSize };
    } finally {
      fs.closeSync(fd);
    }
  }

  private readRecordAt(index: number, into: Buffer): void {
    const fd = fs.openSync(this.slabPath, 'r');
    try {
      const target = TQ_HEADER_BYTES + index * TQ_RECORD_BYTES;
      let got = 0;
      while (got < TQ_RECORD_BYTES) {
        const n = fs.readSync(fd, into, got, TQ_RECORD_BYTES - got, target + got);
        if (n <= 0) throw new Error(`TurboQuantSlab: unexpected EOF reading record ${index}: ${this.slabPath}`);
        got += n;
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}

function writeHeader(hdr: Buffer, seed: number, count: number): void {
  hdr.fill(0);
  hdr.write(TQ_MAGIC, 0, 4, 'ascii');
  hdr.writeUInt16LE(TQ_VERSION, 4);
  hdr.writeUInt16LE(TQ_DIM, 6);
  hdr.writeUInt16LE(TQ_RECORD_BYTES, 8);
  hdr.writeUInt16LE(0, 10); // reserved
  hdr.writeUInt32LE(count >>> 0, 12); // u64 low word
  hdr.writeUInt32LE(Math.floor(count / 0x100000000), 16); // u64 high word
  hdr.writeUInt32LE(seed >>> 0, 20); // seed
  hdr.writeUInt32LE(0, 24); // flags
}

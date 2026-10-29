/**
 * @astram/turboquant — Google TurboQuant 3.5-bit flight recorder
 * (PolarQuant + 1-bit QJL) writing 772-byte records to turboquant.slab.
 * Public API per docs/CONTRACTS.md §8; implementation deviations documented
 * in the module files and docs/error-log/turboquant-worker.md.
 */

// Core quantizer + estimator (record layout, quantizeRecord, decode helpers).
export {
  TQ_DIM,
  TQ_RECORD_BYTES,
  TQ_DEFAULT_SEED,
  TQ_OFFSET_NORMS,
  TQ_OFFSET_CODES,
  TQ_OFFSET_SIGNS,
  quantizeRecord,
  decodeNorms,
  decodeUnitVector,
  estimateInnerProductRecords,
} from './quantize.js';
export type { TqNorms, TqQuantizedRecord } from './quantize.js';

// Slab file (append-only binary store + top-K scan).
export {
  TurboQuantSlab,
  TQ_HEADER_BYTES,
  TQ_MAGIC,
  TQ_VERSION,
  TQ_CODES_BYTES,
  TQ_SIGNS_BYTES,
} from './slab.js';
export type { TqAppendResult, TqMatch, TqScanResult, TurboQuantSlabOptions } from './slab.js';

// Behavioral feature vectors (the 1536-dim x fed to append()).
export { buildBehaviorVector } from './behavior.js';
export type { BehaviorFeatures } from './behavior.js';

// Orthogonal transform Π (signed Walsh–Hadamard construction).
export {
  TQ_PAD_DIM,
  fwhtInPlace,
  signedFwt2048,
  projectUnit,
  embedBack,
  getProjectionSigns,
} from './orthogonal.js';
export type { ProjectionSigns } from './orthogonal.js';

// QJL sign projection (structured S = T2·H·T1/√n).
export { computeQjlSigns } from './qjl.js';

// Lloyd–Max 8-level scalar quantizer for N(0,1).
export {
  getLloydMax8,
  quantizeScalarIndex,
  decodeIndex,
  normPdf,
  normCdf,
  erf,
  probit,
} from './lloydmax.js';
export type { LloydMax8 } from './lloydmax.js';

// Bit packing + software POPCNT.
export {
  pack3BitCodes,
  unpack3BitCodes,
  packSignBits,
  unpackSignBits,
  POPCOUNT_U8,
  popcountDiffU32,
} from './bitpack.js';

// FP16 (norms) + deterministic PRNG helpers.
export { encodeFp16, decodeFp16 } from './fp16.js';
export { mulberry32, hashToSeed32 } from './prng.js';

// Universal Hardware Accelerator (CUDA GPU & Multi-tier AMD/Intel CPU).
export {
  getAcceleratorInfo,
  probeNvidiaGpu,
  probeCpu,
  fastPopcountDiffU32,
  fwhtInPlaceOptimized,
  POPCOUNT_U16,
} from './accelerator.js';
export type {
  DeviceType,
  CpuFamily,
  CpuTier,
  GpuDetails,
  CpuDetails,
  AcceleratorInfo,
} from './accelerator.js';

// CUDA batch execution & accelerated top-K scan
export { executeBatchQuantize, executeAcceleratedScanTopK } from './cuda-worker.js';
export type { CudaExecutionResult } from './cuda-worker.js';

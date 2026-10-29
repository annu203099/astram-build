import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fastPopcountDiffU32,
  fwhtInPlaceOptimized,
  getAcceleratorInfo,
  POPCOUNT_U16,
  probeCpu,
  probeNvidiaGpu,
} from './accelerator.js';
import { POPCOUNT_U8, popcountDiffU32 } from './bitpack.js';
import { fwhtInPlace, TQ_PAD_DIM } from './orthogonal.js';
import { mulberry32 } from './prng.js';

describe('Hardware Accelerator & Device Probe', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('probeCpu identifies host CPU architecture, core count, and family (AMD/Intel/ARM)', () => {
    const cpu = probeCpu();
    expect(cpu.arch).toBe(process.arch);
    expect(cpu.cores).toBeGreaterThanOrEqual(1);
    expect(typeof cpu.model).toBe('string');
    expect(['amd', 'intel', 'arm', 'other']).toContain(cpu.family);
    expect(cpu.optimizationTier).toBe('bit-parallel-unrolled');
  });

  it('probeNvidiaGpu never throws and returns a valid GpuDetails record', () => {
    const gpu = probeNvidiaGpu();
    expect(typeof gpu.available).toBe('boolean');
    expect(typeof gpu.model).toBe('string');
    expect(typeof gpu.driverVersion).toBe('string');
    expect(typeof gpu.totalVramMb).toBe('number');
    expect(gpu.totalVramMb).toBeGreaterThanOrEqual(0);
  });

  it('detects CUDA presence through environment configuration when present', () => {
    process.env.CUDA_PATH = 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.0';
    const gpu = probeNvidiaGpu();
    expect(gpu.available).toBe(true);
    expect(gpu.totalVramMb).toBeGreaterThan(0);
  });

  it('getAcceleratorInfo returns structured device metadata with valid memory budgets', () => {
    const info = getAcceleratorInfo(true);
    expect(['cuda', 'cpu']).toContain(info.device);
    expect(typeof info.activeAcceleration).toBe('string');
    expect(info.memoryBudgetMb).toBeGreaterThan(0);
    expect(info.memoryBudgetMb).toBeLessThanOrEqual(1500); // Handbook §1 ceiling
    expect(info.cpu.cores).toBeGreaterThanOrEqual(1);
  });

  it('honors ASTRAM_ACCELERATOR=cpu override explicitly', () => {
    process.env.ASTRAM_ACCELERATOR = 'cpu';
    const info = getAcceleratorInfo(true);
    expect(info.device).toBe('cpu');
    expect(info.memoryBudgetMb).toBe(1500);
    expect(info.activeAcceleration).toContain('Universal CPU');
  });

  it('honors ASTRAM_ACCELERATOR=cuda override with fallback safeguards', () => {
    process.env.ASTRAM_ACCELERATOR = 'cuda';
    const info = getAcceleratorInfo(true);
    expect(info.device).toBe('cuda');
    expect(info.memoryBudgetMb).toBe(350); // Handbook §1 VRAM ceiling 0.35 GB
    expect(info.activeAcceleration).toContain('NVIDIA CUDA');
  });
});

describe('Adaptive CPU Engine — Fast Bit-Parallel POPCNT & FWHT', () => {
  it('POPCOUNT_U16 table correctly mirrors 16-bit Hamming weights', () => {
    expect(POPCOUNT_U16.length).toBe(65536);
    expect(POPCOUNT_U16[0]).toBe(0);
    expect(POPCOUNT_U16[1]).toBe(1);
    expect(POPCOUNT_U16[0xffff]).toBe(16);
    expect(POPCOUNT_U16[0x5555]).toBe(8);
    expect(POPCOUNT_U16[0xaaaa]).toBe(8);
  });

  it('fastPopcountDiffU32 produces identical results to reference popcountDiffU32 across diverse words', () => {
    const words = 48; // 48 × 32 = 1536 bits
    const a = new Uint32Array(words);
    const b = new Uint32Array(words);

    // Test case 1: Identical (zero difference)
    for (let i = 0; i < words; i++) {
      a[i] = (i * 1234567) >>> 0;
      b[i] = a[i];
    }
    expect(fastPopcountDiffU32(a, b, words)).toBe(0);
    expect(fastPopcountDiffU32(a, b, words)).toBe(popcountDiffU32(a, b, words));

    // Test case 2: Complete inversion (all 1536 bits differ)
    for (let i = 0; i < words; i++) {
      b[i] = ~a[i] >>> 0;
    }
    expect(fastPopcountDiffU32(a, b, words)).toBe(1536);
    expect(fastPopcountDiffU32(a, b, words)).toBe(popcountDiffU32(a, b, words));

    // Test case 3: Pseudorandom bit patterns
    const rng = mulberry32(98765);
    for (let trial = 0; trial < 20; trial++) {
      for (let i = 0; i < words; i++) {
        a[i] = (rng() * 0x100000000) >>> 0;
        b[i] = (rng() * 0x100000000) >>> 0;
      }
      const ref = popcountDiffU32(a, b, words);
      const opt = fastPopcountDiffU32(a, b, words);
      expect(opt).toBe(ref);
    }
  });

  it('fwhtInPlaceOptimized produces mathematically identical output to canonical fwhtInPlace on 2048-dim vectors', () => {
    const n = TQ_PAD_DIM; // 2048
    const a = new Float64Array(n);
    const b = new Float64Array(n);

    const rng = mulberry32(54321);
    for (let trial = 0; trial < 5; trial++) {
      for (let i = 0; i < n; i++) {
        const val = (rng() - 0.5) * 10;
        a[i] = val;
        b[i] = val;
      }

      fwhtInPlace(a);
      fwhtInPlaceOptimized(b);

      for (let i = 0; i < n; i++) {
        expect(Math.abs(b[i] - a[i])).toBeLessThan(1e-9);
      }
    }
  });

  it('fwhtInPlace preserves vector energy (Parseval relation) in optimized path', () => {
    const n = TQ_PAD_DIM;
    const v = new Float64Array(n);
    const rng = mulberry32(112233);
    for (let i = 0; i < n; i++) v[i] = rng() - 0.5;

    let inEnergy = 0;
    for (let i = 0; i < n; i++) inEnergy += v[i] * v[i];

    fwhtInPlaceOptimized(v);

    let outEnergy = 0;
    for (let i = 0; i < n; i++) outEnergy += v[i] * v[i];

    // Walsh-Hadamard transform scales energy by exactly N (2048)
    const ratio = outEnergy / inEnergy;
    expect(Math.abs(ratio - n)).toBeLessThan(1e-6);
  });
});

describe('CUDA Acceleration Worker & Automatic Fallback', () => {
  it('executeBatchQuantize processes batch vectors with fallback safety', async () => {
    const { executeBatchQuantize } = await import('./cuda-worker.js');
    const vectors = [
      new Float32Array(1536).fill(0.1),
      new Float32Array(1536).fill(0.2),
      new Float32Array(1536).fill(0.3),
    ];

    const result = executeBatchQuantize(vectors, 42);
    expect(result.success).toBe(true);
    expect(['cuda', 'cpu']).toContain(result.usedDevice);
    expect(result.result).toHaveLength(3);
    expect(result.result[0].record.length).toBe(772);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});



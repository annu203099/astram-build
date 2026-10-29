/**
 * Behavioral feature vector builder (Handbook §6.4): every MCP tool call /
 * agent turn becomes a 1536-dim vector x ∈ R^1536 encoding AST capability
 * counts, file-path entropy, network socket flags, token velocity and Decision
 * API context embeddings — the input to TurboQuantSlab.append.
 *
 * Layout: [0..5] capability counts, [6] pathEntropy, [7] netFlags,
 * [8] tokenVelocity, [9..9+n) context embedding (≤ 384 values), rest filled
 * with seeded small-magnitude noise (deterministic via hashToSeed32) so that
 * similar inputs produce similar slabs while remaining reproducible.
 */

import { hashToSeed32, mulberry32 } from './prng.js';
import { TQ_DIM } from './quantize.js';

export interface BehaviorFeatures {
  /** Counts per CapabilityCategory (PROC_EXEC, DYNAMIC_EVAL, CRED_ACCESS, NET_EGRESS, STARTUP_HOOK, BYTEPATH_SINK). */
  astCapabilityCounts: number[];
  /** Shannon entropy of the touched file paths (0..16 typical). */
  pathEntropy: number;
  /** Network egress flags observed in the turn. */
  netFlags: number;
  /** Tokens per second observed for the turn. */
  tokenVelocity: number;
  /** Optional Decision API context embedding (up to 384 values are used). */
  contextEmbedding?: number[];
}

export function buildBehaviorVector(f: BehaviorFeatures): Float32Array {
  const v = new Float32Array(TQ_DIM);
  const counts = f.astCapabilityCounts ?? [];
  for (let i = 0; i < 6; i++) v[i] = Number.isFinite(counts[i]) ? counts[i] : 0;
  v[6] = Number.isFinite(f.pathEntropy) ? f.pathEntropy : 0;
  v[7] = Number.isFinite(f.netFlags) ? f.netFlags : 0;
  v[8] = Number.isFinite(f.tokenVelocity) ? f.tokenVelocity : 0;
  const emb = f.contextEmbedding ?? [];
  const cap = Math.min(emb.length, 384);
  for (let i = 0; i < cap; i++) v[9 + i] = Number.isFinite(emb[i]) ? emb[i] : 0;

  const head: number[] = [];
  for (let i = 0; i < 9 + Math.min(cap, 64); i++) head.push(v[i]);
  const rnd = mulberry32(hashToSeed32(head));
  for (let i = 9 + cap; i < TQ_DIM; i++) v[i] = (rnd() * 2 - 1) * 0.01;
  return v;
}

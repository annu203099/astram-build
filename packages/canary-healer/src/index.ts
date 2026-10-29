/**
 * @astram/canary — Darwinian Canary Self-Healing Loop (docs/CONTRACTS.md §9,
 * Handbook §6.5 Module 5). Public API:
 *   CanaryHealer, HealCandidate, HealReport, generateDeterministicCandidates
 * (+ applyPatch exposed for direct patch-application testing).
 */
export { applyPatch, generateDeterministicCandidates } from './candidates.js';
export type { HealCandidate, HealCandidateResult, HealPatchOp, HealReport } from './types.js';
export { CanaryHealer } from './healer.js';
export type { CanaryHealerDeps, HealVerifier, VerifyResult } from './healer.js';

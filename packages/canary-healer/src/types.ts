/**
 * @astram/canary contract types — exactly docs/CONTRACTS.md §9.
 */

export interface HealPatchOp {
  file: string;
  /** Exact substring to find in the file content. */
  find: string;
  /** Literal replacement text (no $-pattern expansion). */
  replace: string;
}

export interface HealCandidate {
  id: string;
  description: string;
  patch: HealPatchOp[];
  source: 'jev' | 'deterministic';
}

export interface HealCandidateResult {
  id: string;
  blockedExploit: boolean;
  unitTestsPassed: boolean;
  promoted: boolean;
}

export interface HealReport {
  violationTxId: string;
  forkedFiberId: string;
  attempted: boolean;
  healed: boolean;
  winningCandidateId?: string;
  candidates: HealCandidateResult[];
  elapsedMs: number;
}

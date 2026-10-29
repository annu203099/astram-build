/**
 * @astram/canary — Darwinian Canary Self-Healing Loop (docs/CONTRACTS.md §9,
 * Handbook §6.5 "Module 5").
 *
 * Flow: on a policy violation, fork the violating tx in the Multiverse DAG,
 * open a Cordis Fiber (detached git worktree) for the fork, generate heal
 * candidates (deterministic offline patches first, then the Jev Decision API's
 * suggestedPatchSnippet when configured), apply each candidate INSIDE the
 * fiber worktree and run the caller-supplied verifier (exploit + unit tests).
 * A candidate that blocks the exploit AND passes the unit tests is promoted to
 * the live workspace via Fiber.commitToMain (the "0 ms hot-swap" apply path)
 * and the fork node + ledger tx are marked CANARY_HEALED. Failures dispose the
 * fiber ROLLED_BACK and try the next candidate — the main repo is never
 * touched by a losing candidate.
 */
import { randomBytes } from 'node:crypto';
import { Fiber } from '@astram/cordis-sandbox';
import type { LedgerDb, MultiverseDag } from '@astram/db';
import type { JevDecisionClient } from '@astram/gatekeeper';
import { newTxId, type AtomicAuditTx, type PolicyVerdict } from '@astram/types';
import { applyPatch, generateDeterministicCandidates } from './candidates.js';
import type { HealCandidate, HealPatchOp, HealReport } from './types.js';

export interface CanaryHealerDeps {
  ledger: LedgerDb;
  dag: MultiverseDag;
  /** Optional Decision API client; null/undefined = deterministic-only. */
  jev?: JevDecisionClient | null;
  /** Repository the violation happened in (must be a git repo). */
  repoRoot: string;
  /**
   * Where Fiber worktrees are created. Optional test-friendly override that
   * keeps the CONTRACTS §9 constructor shape untouched (default stays
   * resolveAstramHome()/worktrees — see docs/error-log/canary-healer.md).
   */
  worktreesRoot?: string;
}

export interface VerifyResult {
  blockedExploit: boolean;
  unitTestsPassed: boolean;
}

export type HealVerifier = (
  candidate: HealCandidate,
  worktreeRoot: string
) => Promise<VerifyResult>;

/** Max candidates tried per violation (CONTRACTS §9 flow: "for each candidate (max 3)"). */
const MAX_TRIED = 3;

export class CanaryHealer {
  private readonly ledger: LedgerDb;
  private readonly dag: MultiverseDag;
  private readonly jev: JevDecisionClient | null;
  private readonly repoRoot: string;
  private readonly worktreesRoot: string | undefined;

  constructor(deps: CanaryHealerDeps) {
    this.ledger = deps.ledger;
    this.dag = deps.dag;
    this.jev = deps.jev ?? null;
    this.repoRoot = deps.repoRoot;
    this.worktreesRoot = deps.worktreesRoot;
  }

  /**
   * Runs the heal loop for one violation. Best-effort by design: unexpected
   * internal errors are logged and surface as a non-healed report, never as a
   * thrown exception (the violation was already stopped by the proxy).
   */
  async onViolation(
    verdict: PolicyVerdict,
    vulnerableFiles: { path: string; content: string }[],
    verify: HealVerifier
  ): Promise<HealReport> {
    const t0 = Date.now();
    const txId = newTxId(verdict); // PolicyVerdict carries no txId — derive a stable one
    const report: HealReport = {
      violationTxId: txId,
      forkedFiberId: '',
      attempted: false,
      healed: false,
      candidates: [],
      elapsedMs: 0,
    };
    let commitToMainMs = -1;

    try {
      // (1) Fork the violating tx in the Multiverse DAG (synthesize a node
      //     for verdicts that never reached the DAG as a tx).
      this.ensureDagNode(txId, verdict);
      const priorForks = this.dag.getChildren(txId).filter((c) => c.canaryFork).length;
      const fork = this.dag.forkNode(txId, `canary-${priorForks + 1}`);

      // (3)+(4) Candidates: deterministic offline patches ALWAYS, plus the
      // Jev suggestedPatchSnippet when the Decision API is configured.
      const candidates = generateDeterministicCandidates(vulnerableFiles);
      const jevCandidate = await this.jevCandidate(verdict, vulnerableFiles);
      if (jevCandidate) candidates.push(jevCandidate);

      for (const candidate of candidates) {
        report.candidates.push({
          id: candidate.id,
          blockedExploit: false,
          unitTestsPassed: false,
          promoted: false,
        });
      }
      const rowById = new Map(report.candidates.map((r) => [r.id, r]));

      // (5) Darwinian tournament — max 3 candidates, fresh worktree each.
      const tried = candidates.filter((c) => c.patch.length > 0).slice(0, MAX_TRIED);
      for (const candidate of tried) {
        const row = rowById.get(candidate.id);
        if (!row) continue;

        const applied = this.applyCandidate(candidate, vulnerableFiles);
        if (!applied) continue; // anchors missing — recorded above, never verified

        const fiber = new Fiber({
          repoRoot: this.repoRoot,
          worktreesRoot: this.worktreesRoot,
          fiberId: `${fork.label}-r${candidate.id}-${randomBytes(3).toString('hex')}`,
        });
        try {
          await fiber.begin();
        } catch (err) {
          console.error(
            `[canary] fiber begin failed (${candidate.id}): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          continue;
        }
        report.forkedFiberId = fiber.id;
        report.attempted = true;

        for (const [file, content] of applied) await fiber.writeFile(file, content);

        let result: VerifyResult = { blockedExploit: false, unitTestsPassed: false };
        try {
          result = await verify(candidate, fiber.worktreePath);
        } catch (err) {
          console.error(
            `[canary] verifier threw for ${candidate.id} (treated as failed): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
        row.blockedExploit = result.blockedExploit === true;
        row.unitTestsPassed = result.unitTestsPassed === true;

        if (row.blockedExploit && row.unitTestsPassed) {
          const c0 = Date.now();
          const commit = await fiber.commitToMain(); // Cordis hot-swap: apply diff to main repo
          commitToMainMs = Date.now() - c0;
          await fiber.dispose(commit.promoted ? 'COMMITTED' : 'ROLLED_BACK'); // commit path already tore down; no-op safety
          if (commit.promoted) {
            row.promoted = true;
            this.dag.markDisposition(fork.txId, 'CANARY_HEALED');
            this.markLedgerHealed(txId, verdict, fiber.id);
            report.healed = true;
            report.winningCandidateId = candidate.id;
            break;
          }
          continue; // promotion lost the race (dirty main / conflict) — next candidate
        }

        await fiber.dispose('ROLLED_BACK');
      }
    } catch (err) {
      console.error(
        `[canary] onViolation internal error (reporting non-healed): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    report.elapsedMs = Date.now() - t0;
    console.log(
      `[canary] onViolation tx=${txId.slice(0, 12)}… healed=${report.healed} ` +
        `winner=${report.winningCandidateId ?? 'none'} elapsedMs=${report.elapsedMs}` +
        (commitToMainMs >= 0 ? ` commitToMainMs=${commitToMainMs}` : '')
    );
    return report;
  }

  // ------------------------------------------------------------------ private

  /** Adds a synthetic node when the violating tx never reached the DAG. */
  private ensureDagNode(txId: string, verdict: PolicyVerdict): void {
    try {
      this.dag.pathToRoot(txId);
      return; // present
    } catch {
      // fall through: synthesize
    }
    this.dag.addNode({
      txId,
      parentTxId: null,
      disposition: verdict.disposition === 'BLOCKED_PRE_EXEC' ? 'BLOCKED_PRE_EXEC' : 'ROLLED_BACK',
      finalRisk: verdict.finalRisk,
      canaryFork: false,
      label: verdict.target,
    });
  }

  /**
   * Builds the 'jev' candidate from the Decision API's suggestedPatchSnippet.
   * Defensive by contract: API failure = skip (null), never throw. The snippet
   * is anchored by matching one vulnerable file line inside it; when no line
   * matches, the candidate carries an empty patch (recorded, never verified).
   */
  private async jevCandidate(
    verdict: PolicyVerdict,
    vulnerableFiles: { path: string; content: string }[]
  ): Promise<HealCandidate | null> {
    if (!this.jev) return null;
    try {
      const res = await this.jev.evaluateAstFacts(verdict.target, verdict.reasoning, verdict.facts);
      const snippet = typeof res.suggestedPatchSnippet === 'string' ? res.suggestedPatchSnippet.trim() : '';
      if (snippet === '') return null;
      const patch: HealPatchOp[] = [];
      for (const vf of vulnerableFiles) {
        const lines = vf.content.split(/\r?\n/);
        const idx = lines.findIndex((l) => l.trim().length > 0 && snippet.includes(l.trim()));
        if (idx >= 0) {
          patch.push({ file: vf.path, find: lines[idx], replace: snippet });
          break;
        }
      }
      return {
        id: 'jev-1',
        description: `Jev Decision API suggested patch${
          res.reasoning ? `: ${res.reasoning.slice(0, 140)}` : ''
        }`,
        patch,
        source: 'jev',
      };
    } catch {
      return null; // fail-closed to the deterministic candidates
    }
  }

  /**
   * Applies a candidate's patch ops to the vulnerable file contents
   * (in memory). Returns null when any anchor is missing or references an
   * unknown file — the candidate is then recorded as not applicable.
   */
  private applyCandidate(
    candidate: HealCandidate,
    vulnerableFiles: { path: string; content: string }[]
  ): Map<string, string> | null {
    const base = new Map(vulnerableFiles.map((f) => [f.path, f.content]));
    const grouped = new Map<string, HealPatchOp[]>();
    for (const op of candidate.patch) {
      if (!base.has(op.file)) return null;
      const ops = grouped.get(op.file) ?? [];
      ops.push(op);
      grouped.set(op.file, ops);
    }
    if (grouped.size === 0) return null;
    const out = new Map<string, string>();
    for (const [file, ops] of grouped) {
      const r = applyPatch(base.get(file) as string, ops);
      if (!r.ok) return null;
      out.set(file, r.content);
    }
    return out;
  }

  /** Marks the ledger tx CANARY_HEALED, synthesizing the tx when absent. */
  private markLedgerHealed(txId: string, verdict: PolicyVerdict, fiberId: string): void {
    try {
      if (this.ledger.getTx(txId) === undefined) {
        const tx: AtomicAuditTx = {
          txId,
          sessionId: 'canary-healer',
          fiberId,
          parentTxId: null,
          agentHost: 'claude-code',
          timestampMs: Date.now(),
          policyCharterId: 'astram-policy-charter-v1',
          statedExplanation: verdict.reasoning.slice(0, 500),
          mcpServerId: 'astram-canary',
          toolName: verdict.target,
          redactedArgumentsJson: JSON.stringify({ target: verdict.target, category: verdict.category }),
          deterministicRisk: verdict.deterministicRisk,
          decisionApiDelta: verdict.apiDelta,
          finalMonotonicRisk: verdict.finalRisk,
          fsModifiedFilesJson: '[]',
          turboquantSlabIndex: null,
          anomalyScore: 0,
          violationDetected: 1,
          disposition: 'BLOCKED_PRE_EXEC',
        };
        this.ledger.insertAtomicTx(tx);
      }
      this.ledger.updateTxDisposition(txId, 'CANARY_HEALED');
    } catch (err) {
      console.error(
        `[canary] ledger disposition update failed (heal already applied to repo): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

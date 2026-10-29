/**
 * @astram/gatekeeper — one-shot evaluation convenience used by the proxy,
 * server and testbed. Computes the deterministic max, optionally consults the
 * Jev Decision API, and returns a PolicyVerdict.
 */
import {
  maxDeterministicRisk,
  RiskLevel,
  type AstCapabilityFact,
  type BoardingCategory,
  type PolicyVerdict,
} from '@astram/types';
import type { JevDecisionClient } from './jev-decision-client.js';

export interface EvaluateArtifactInput {
  artifactName: string;
  statedPurpose?: string;
  category: BoardingCategory;
  facts: AstCapabilityFact[];
  jev?: JevDecisionClient;
}

/** Up to 3 ruleIds, highest deterministic risk first, first-seen tiebreak. */
function evidenceSummaryOf(facts: AstCapabilityFact[]): string {
  const order: string[] = [];
  const risk = new Map<string, RiskLevel>();
  for (const f of facts) {
    const prev = risk.get(f.ruleId);
    if (prev === undefined) {
      risk.set(f.ruleId, f.deterministicRisk);
      order.push(f.ruleId);
    } else if (f.deterministicRisk > prev) {
      risk.set(f.ruleId, f.deterministicRisk);
    }
  }
  const sorted = [...order].sort(
    (a, b) => (risk.get(b) ?? RiskLevel.PASS) - (risk.get(a) ?? RiskLevel.PASS)
  );
  return sorted.slice(0, 3).join(', ');
}

export async function evaluateArtifact(input: EvaluateArtifactInput): Promise<PolicyVerdict> {
  const deterministicRisk = maxDeterministicRisk(input.facts);
  let finalRisk = deterministicRisk;
  let apiDelta = 0;
  let reasoning = 'Deterministic AST baseline verdict (no Decision API configured).';
  if (input.jev) {
    const res = await input.jev.evaluateAstFacts(
      input.artifactName,
      input.statedPurpose ?? '',
      input.facts
    );
    finalRisk = res.finalRisk;
    apiDelta = res.apiDelta;
    reasoning = res.reasoning;
  }
  return {
    target: input.artifactName,
    category: input.category,
    deterministicRisk,
    apiDelta,
    finalRisk,
    reasoning,
    evidenceSummary: evidenceSummaryOf(input.facts),
    facts: input.facts,
    disposition: finalRisk === RiskLevel.HOLD ? 'BLOCKED_PRE_EXEC' : 'COMMITTED',
  };
}

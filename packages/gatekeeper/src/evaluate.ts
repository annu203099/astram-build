import fs from 'node:fs';
import path from 'node:path';
import {
  maxDeterministicRisk,
  RiskLevel,
  type AstCapabilityFact,
  type BoardingCategory,
  type PolicyVerdict,
} from '@astram/types';
import type { JevDecisionClient } from './jev-decision-client.js';
import {
  analyzeBytePathJs,
  analyzeBytePathPython,
  analyzeBytePathRuby,
  analyzeBytePathPhp,
  taintFactsFromSinks,
  type TaintSink,
} from './bytepath-taint.js';

export interface EvaluateArtifactInput {
  artifactName: string;
  statedPurpose?: string;
  category: BoardingCategory;
  facts: AstCapabilityFact[];
  code?: string;
  filePath?: string;
  jev?: JevDecisionClient;
}

/** Uply to 3 ruleIds, highest deterministic risk first, first-seen tiebreak. */
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
  const allFacts = [...(input.facts ?? [])];

  let code = input.code;
  if (!code && input.filePath) {
    try {
      if (fs.existsSync(input.filePath)) {
        code = fs.readFileSync(input.filePath, 'utf8');
      }
    } catch {
      // non-fatal disk read
    }
  }

  if (code) {
    const sinks: TaintSink[] = [];
    const ext = path.extname(input.artifactName || input.filePath || '').toLowerCase();

    if (!ext || ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs') {
      sinks.push(...analyzeBytePathJs(code, input.artifactName));
    }
    if (!ext || ext === '.py' || ext === '.pth') {
      sinks.push(...analyzeBytePathPython(code, input.artifactName));
    }
    if (!ext || ext === '.rb') {
      sinks.push(...analyzeBytePathRuby(code, input.artifactName));
    }
    if (!ext || ext === '.php') {
      sinks.push(...analyzeBytePathPhp(code, input.artifactName));
    }

    if (sinks.length > 0) {
      allFacts.push(...taintFactsFromSinks(sinks, input.artifactName));
    }
  }

  const deterministicRisk = maxDeterministicRisk(allFacts);
  let finalRisk = deterministicRisk;
  let apiDelta = 0;
  let reasoning = 'Deterministic AST baseline verdict (no Decision API configured).';
  if (input.jev) {
    const res = await input.jev.evaluateAstFacts(
      input.artifactName,
      input.statedPurpose ?? '',
      allFacts
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
    evidenceSummary: evidenceSummaryOf(allFacts),
    facts: allFacts,
    disposition: finalRisk === RiskLevel.HOLD ? 'BLOCKED_PRE_EXEC' : 'COMMITTED',
  };
}

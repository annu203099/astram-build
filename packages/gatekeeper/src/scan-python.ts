/**
 * @astram/gatekeeper — Python source + .pth startup-hook scans (regex-based).
 *
 * Rules (contract docs/CONTRACTS.md §2 deterministic rule table):
 *   PY_EXEC        DYNAMIC_EVAL WARN   exec( / eval( in python source
 *   PY_ENV_READ    CRED_ACCESS   WARN   os.environ / os.getenv
 *   PY_NET_EGRESS  NET_EGRESS    WARN   urllib.request / requests. / socket. / httpx
 *   PY_PTH_CODE    STARTUP_HOOK  HOLD   any non-comment code in a .pth file
 *   PTH_EXFIL_CHAIN STARTUP_HOOK HOLD   .pth combining env/credential read +
 *                                        network egress
 *
 * scanPythonPth additionally surfaces the scanPythonCode facts (PY_ENV_READ /
 * PY_NET_EGRESS / PY_EXEC) so callers get the CRED_ACCESS / NET_EGRESS /
 * DYNAMIC_EVAL categories the Handbook TEST-01 assertion requires
 * (categories ⊇ {STARTUP_HOOK, CRED_ACCESS, NET_EGRESS}).
 */
import { RiskLevel, type AstCapabilityFact, type CapabilityCategory } from '@astram/types';

interface PyRule {
  ruleId: string;
  category: CapabilityCategory;
  risk: RiskLevel;
  re: RegExp;
}

const PY_RULES: readonly PyRule[] = [
  { ruleId: 'PY_EXEC', category: 'DYNAMIC_EVAL', risk: RiskLevel.WARN, re: /\b(?:exec|eval)\s*\(/ },
  { ruleId: 'PY_ENV_READ', category: 'CRED_ACCESS', risk: RiskLevel.WARN, re: /\bos\.environ\b|\bos\.getenv\s*\(/ },
  {
    ruleId: 'PY_NET_EGRESS',
    category: 'NET_EGRESS',
    risk: RiskLevel.WARN,
    re: /\burllib\.request\b|\brequests\.|\bsocket\.|\bhttpx\b/,
  },
];

export function scanPythonCode(code: string, file: string): AstCapabilityFact[] {
  const lines = code.split('\n');
  const facts: AstCapabilityFact[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    for (const rule of PY_RULES) {
      if (rule.re.test(line)) {
        facts.push({
          ruleId: rule.ruleId,
          category: rule.category,
          file,
          line: lineNo,
          snippet: line.trim().slice(0, 200),
          deterministicRisk: rule.risk,
        });
      }
    }
  }
  return facts;
}

/** A plain `import <single module>` line is the only tolerated non-comment content. */
const PTH_PLAIN_IMPORT = /^import\s+[A-Za-z_][A-Za-z0-9_.]*\s*$/;
const PTH_ENV_READ = /\bos\.environ\b|\bos\.getenv\s*\(|AEGIS_CANARY_SECRET_[A-Za-z0-9_]+/;
const PTH_NET_EGRESS = /\burllib\.request\b|\brequests\.|\bsocket\.|\bhttpx\b|\burlopen\b/;

export function scanPythonPth(content: string, file: string): AstCapabilityFact[] {
  // Pure string ops only — TEST-01 timing budget is < 50 ms.
  const facts: AstCapabilityFact[] = scanPythonCode(content, file);
  const lines = content.split('\n');
  let envLine = 0;
  let netLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNo = i + 1;
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (!PTH_PLAIN_IMPORT.test(trimmed)) {
      facts.push({
        ruleId: 'PY_PTH_CODE',
        category: 'STARTUP_HOOK',
        file,
        line: lineNo,
        snippet: trimmed.slice(0, 200),
        deterministicRisk: RiskLevel.HOLD,
      });
    }
    if (!envLine && PTH_ENV_READ.test(trimmed)) envLine = lineNo;
    if (!netLine && PTH_NET_EGRESS.test(trimmed)) netLine = lineNo;
  }

  if (envLine > 0 && netLine > 0) {
    const lineNo = Math.max(envLine, netLine); // line completing the exfil chain
    facts.push({
      ruleId: 'PTH_EXFIL_CHAIN',
      category: 'STARTUP_HOOK',
      file,
      line: lineNo,
      snippet: (lines[lineNo - 1] ?? '').trim().slice(0, 200),
      deterministicRisk: RiskLevel.HOLD,
    });
  }

  return facts;
}

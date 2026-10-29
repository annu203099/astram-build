/**
 * @astram/gatekeeper — bash/PowerShell/cmd one-liner scan (regex-based).
 *
 * Rules (contract docs/CONTRACTS.md §2 deterministic rule table):
 *   SHELL_PIPE_DOWNLOAD  PROC_EXEC  WARN  curl|wget piped into sh/bash, iex(...),
 *                                             Invoke-Expression
 *   JS_SHELL_CRED_READ   CRED_ACCESS HOLD  protected path appearing in the
 *                                             command string (tokenize on
 *                                             whitespace/quotes, each token
 *                                             through isProtectedPath)
 */
import { isProtectedPath, RiskLevel, type AstCapabilityFact } from '@astram/types';
import { lineAt, snippetFor } from './util.js';

const CURL_OR_WGET = /\b(curl|wget)\b/i;
/** `| sh`, `| bash`, `| sudo zsh`, `| dash`, `| fish`, ... */
const PIPE_INTO_SHELL = /\|\s*(?:sudo\s+)?(?:[a-z]{0,2}sh)\b/i;
const IEX_CALL = /\biex\s*\(/i;
const INVOKE_EXPRESSION = /\binvoke-expression\b/i;

export function scanShellSnippet(cmd: string, file: string): AstCapabilityFact[] {
  const facts: AstCapabilityFact[] = [];
  const lines = cmd.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const lineNo = i + 1;
    const snippet = line.trim().slice(0, 200);

    if (CURL_OR_WGET.test(line) && PIPE_INTO_SHELL.test(line)) {
      facts.push({
        ruleId: 'SHELL_PIPE_DOWNLOAD',
        category: 'PROC_EXEC',
        file,
        line: lineNo,
        snippet,
        deterministicRisk: RiskLevel.WARN,
      });
    }
    if (IEX_CALL.test(line)) {
      facts.push({
        ruleId: 'SHELL_PIPE_DOWNLOAD',
        category: 'PROC_EXEC',
        file,
        line: lineNo,
        snippet,
        deterministicRisk: RiskLevel.WARN,
      });
    }
    if (INVOKE_EXPRESSION.test(line)) {
      facts.push({
        ruleId: 'SHELL_PIPE_DOWNLOAD',
        category: 'PROC_EXEC',
        file,
        line: lineNo,
        snippet,
        deterministicRisk: RiskLevel.WARN,
      });
    }
  }

  // Protected credential paths anywhere in the command string.
  const tokenRe = /[^\s"'`]+/g;
  const seenLines = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(cmd)) !== null) {
    const tok = m[0].replace(/^[;,()&|<>]+|[;,()&|<>]+$/g, '');
    if (!tok) continue;
    const r = isProtectedPath(tok);
    if (r.protected) {
      const lineNo = lineAt(cmd, m.index);
      if (seenLines.has(lineNo)) continue; // one fact per offending line
      seenLines.add(lineNo);
      facts.push({
        ruleId: 'JS_SHELL_CRED_READ',
        category: 'CRED_ACCESS',
        file,
        line: lineNo,
        snippet: snippetFor(lines, lineNo),
        deterministicRisk: RiskLevel.HOLD,
      });
    }
  }

  return facts;
}

/**
 * @astram/gatekeeper — SKILL.md / README scanning.
 *
 * Contract docs/CONTRACTS.md §2: fence extraction → per-language scan
 * (js/javascript/ts/tsx/jsx → scanJavascript, bash/sh/zsh/powershell/ps1/pwsh/cmd
 * → scanShellSnippet, python/py → scanPythonCode) + README_INJECTION_OVERRIDE
 * over the markdown OUTSIDE code fences. injectionDetected = true iff an
 * injection rule fired OR a fence contains an override phrase inside a comment.
 */
import { RiskLevel, type AstCapabilityFact } from '@astram/types';
import { matchesInjection, tokenizeMarkdown } from './markdown.js';
import { scanJavascript } from './scan-javascript.js';
import { scanPythonCode } from './scan-python.js';
import { scanShellSnippet } from './scan-shell.js';

export interface SkillScanResult {
  file: string;
  facts: AstCapabilityFact[];
  injectionDetected: boolean;
}

const JS_LANGS = new Set(['js', 'javascript', 'ts', 'tsx', 'jsx']);
const SHELL_LANGS = new Set(['bash', 'sh', 'zsh', 'powershell', 'ps1', 'pwsh', 'cmd']);
const PY_LANGS = new Set(['python', 'py']);

const COMMENT_PREFIX = /^(\/\/|#)/;

export function scanSkillMarkdown(content: string, file: string): SkillScanResult {
  const { blocks, outsideLines } = tokenizeMarkdown(content);
  const facts: AstCapabilityFact[] = [];
  let injectionDetected = false;

  for (const ol of outsideLines) {
    if (matchesInjection(ol.text)) {
      injectionDetected = true;
      facts.push({
        ruleId: 'README_INJECTION_OVERRIDE',
        category: 'DYNAMIC_EVAL',
        file,
        line: ol.line,
        snippet: ol.text.trim().slice(0, 200),
        deterministicRisk: RiskLevel.WARN,
      });
    }
  }

  for (const block of blocks) {
    const lang = block.lang.toLowerCase();
    let blockFacts: AstCapabilityFact[] = [];
    if (JS_LANGS.has(lang)) blockFacts = scanJavascript(block.code, file);
    else if (SHELL_LANGS.has(lang)) blockFacts = scanShellSnippet(block.code, file);
    else if (PY_LANGS.has(lang)) blockFacts = scanPythonCode(block.code, file);

    // Scanner line numbers are relative to the fence body; the first body line
    // is block.line + 1, so absolute = relative + block.line.
    for (const f of blockFacts) facts.push({ ...f, line: f.line + block.line });

    if (!injectionDetected) {
      for (const codeLine of block.code.split('\n')) {
        const trimmed = codeLine.trim();
        if (COMMENT_PREFIX.test(trimmed) && matchesInjection(trimmed)) {
          injectionDetected = true;
          break;
        }
      }
    }
  }

  return { file, facts, injectionDetected };
}

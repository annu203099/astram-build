/**
 * @astram/gatekeeper — small shared helpers for the deterministic scanners.
 * Pure string operations only: no filesystem, no network (Handbook TEST-01
 * requires the .pth scan path to stay < 50 ms).
 */
import { isProtectedPath } from '@astram/types';

/** Source line for a 1-based line number, trimmed and capped at 200 chars. */
export function snippetFor(lines: string[], line: number): string {
  const raw = lines[line - 1] ?? '';
  return raw.trim().slice(0, 200);
}

/** Split a shell-like string into tokens on whitespace and quote characters. */
export function shellTokens(text: string): string[] {
  const out: string[] = [];
  const re = /[^\s"'`]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[0].replace(/^[;,()&|<>]+|[;,()&|<>]+$/g, '');
    if (tok) out.push(tok);
  }
  return out;
}

/**
 * True if `text` itself, or any shell token inside it, refers to a protected
 * credential path (contract JS_SHELL_CRED_READ semantics: tokenize on
 * whitespace/quotes, run each token through isProtectedPath).
 */
export function protectedPathIn(text: string): { protected: boolean; rule: string | null } {
  if (!text) return { protected: false, rule: null };
  const whole = isProtectedPath(text);
  if (whole.protected) return whole;
  for (const tok of shellTokens(text)) {
    const r = isProtectedPath(tok);
    if (r.protected) return r;
  }
  return { protected: false, rule: null };
}

/** 1-based line number of a character index inside a multi-line string. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  const n = Math.min(index, text.length);
  for (let i = 0; i < n; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

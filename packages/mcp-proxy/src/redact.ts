/**
 * @astram/mcp-proxy — secret redaction, ANSI stripping and UTF-8-safe byte-cap
 * truncation. Stage 1 of the Eventide-Quill / BrowserDelta compactor
 * (Handbook §5.4 item 2) plus the shared redaction used for
 * `redactedArgumentsJson` and `ASTRAM_ORIGINAL_JSON`.
 *
 * Binding contract: docs/CONTRACTS.md §6 (`compactMcpResult`).
 */
import { Buffer } from 'node:buffer';

export interface CompactResult {
  output: string;
  redactedCount: number;
  truncated: boolean;
}

/**
 * Secret redaction classes (contract §6). Order matters: the specific token
 * shapes (sk-/ghp_/AKIA/...) run before the generic `api_key|token|secret|
 * password <value>` shape so a classified hit replaces the whole token and the
 * generic pattern cannot double-match the replacement text.
 */
const REDACTIONS: { re: RegExp; kind: string }[] = [
  { re: /\bsk-[A-Za-z0-9]{16,}/g, kind: 'sk' },
  { re: /\bghp_[A-Za-z0-9]{20,}/g, kind: 'ghp' },
  { re: /\bgho_[A-Za-z0-9]{20,}/g, kind: 'gho' },
  { re: /\bghr_[A-Za-z0-9]{20,}/g, kind: 'ghr' },
  { re: /\bghs_[A-Za-z0-9]{20,}/g, kind: 'ghs' },
  { re: /\bAKIA[0-9A-Z]{16}/g, kind: 'AKIA' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]+/g, kind: 'slack' },
  { re: /\bAEGIS_CANARY_SECRET_[A-Z0-9_]+/g, kind: 'canary' },
  { re: /\bBearer [A-Za-z0-9._-]+/g, kind: 'bearer' },
  {
    re: /\b(?:api[_-]?key|token|secret|password)["'=:\s]+[A-Za-z0-9_\-/.]{16,}/gi,
    kind: 'secret',
  },
];

/** Applies every redaction pattern. Returns the masked text and the total
 *  number of replacements (for telemetry / test assertions). */
export function redactSecrets(text: string): { output: string; redactedCount: number } {
  let out = text;
  let redactedCount = 0;
  for (const { re, kind } of REDACTIONS) {
    out = out.replace(re, (match) => {
      redactedCount += 1;
      return `[REDACTED:${kind}]`;
    });
  }
  return { output: out, redactedCount };
}

/**
 * Strips ANSI escape sequences. Handles both a raw ESC byte and the escaped
 * `\u001b` form that JSON.stringify produces for control characters (the
 * compactor operates on the *stringified* payload, where ESC always appears
 * escaped, but raw-ESC input is tolerated defensively).
 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\\u001[bB]\[[0-9;?]*[A-Za-z]/g, '') // escaped CSI sequences
    .replace(/\\u001[bB]/g, '') // escaped 2-byte escapes
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '') // raw CSI sequences
    .replace(/\u001b[\s\S]/g, ''); // raw 2-byte escapes
}

/** True if `byte` is a UTF-8 continuation byte (0b10xxxxxx). */
function isContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

/**
 * Truncates `text` so its UTF-8 encoding fits in `maxBytes` (including the
 * truncation marker). Never splits a multi-byte character or surrogate pair.
 * Returns the truncated text plus the number of bytes that did not fit.
 */
export function truncateUtf8Safe(
  text: string,
  maxBytes: number
): { output: string; droppedBytes: number } {
  const totalBytes = Buffer.byteLength(text, 'utf8');
  if (totalBytes <= maxBytes) return { output: text, droppedBytes: 0 };

  const suffix = `\u2026[astram: truncated ${totalBytes} bytes]`;
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  // Keep the whole marker even in a pathological maxBytes smaller than it.
  const budget = Math.max(0, maxBytes - suffixBytes);
  const buf = Buffer.from(text, 'utf8');
  let cut = Math.min(budget, buf.length);
  // Walk back onto a character boundary so no multi-byte sequence is split.
  while (cut > 0 && isContinuationByte(buf[cut])) cut -= 1;
  const droppedBytes = totalBytes - cut;
  const suffixN = `\u2026[astram: truncated ${droppedBytes} bytes]`;
  return { output: buf.subarray(0, cut).toString('utf8') + suffixN, droppedBytes };
}

/**
 * Compact one MCP server payload (contract §6):
 *   1. redact leaked secrets (each class replaced with `[REDACTED:<kind>]`),
 *   2. strip ANSI escape sequences,
 *   3. enforce the UTF-8 byte cap with the `…[astram: truncated N bytes]`
 *      marker, where N is the number of payload bytes that did not fit.
 */
export function compactMcpResult(payload: unknown, maxBytes = 32768): CompactResult {
  const original = JSON.stringify(payload ?? null);
  const { output: redacted, redactedCount } = redactSecrets(original);
  const stripped = stripAnsi(redacted);
  const { output, droppedBytes } = truncateUtf8Safe(stripped, maxBytes);
  return { output, redactedCount, truncated: droppedBytes > 0 };
}
